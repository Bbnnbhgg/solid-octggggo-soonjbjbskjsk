import { Router } from 'itty-router';

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  GITHUB_BRANCH: string;
  NOTES_POST_PASSWORD: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const router = Router();
let notes: Note[] = [];

const isRobloxScript = (content: string) =>
  content.includes('game') || content.includes('script');

async function obfuscate(content: string): Promise<string> {
  try {
    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: content }),
    });
    if (!res.ok) return content;
    const data = await res.json();
    return data.obfuscated || content;
  } catch {
    return content;
  }
}

async function filterText(text: string): Promise<string> {
  try {
    const res = await fetch('https://tiny-river-0235.hiplitehehe.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.filtered || text;
  } catch {
    return text;
  }
}

async function storeNotesInGithubFile(env: Env, updatedNotes: Note[]) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;
  let sha: string | undefined;

  const getRes = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const notesObject = updatedNotes.reduce<Record<string, Omit<Note, 'id'>>>((acc, note) => {
    const { id, ...rest } = note;
    acc[id] = rest;
    return acc;
  }, {});

  const encoded = btoa(JSON.stringify(notesObject, null, 2));

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'MyNotesApp/1.0',
    },
    body: JSON.stringify({
      message: 'Update notes',
      content: encoded,
      branch: env.GITHUB_BRANCH,
      ...(sha && { sha }),
    }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`GitHub API error: ${text}`);
  }
}

async function loadNotesFromGithub(env: Env): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  });

  if (res.ok) {
    const data = await res.json();
    const content = atob(data.content);
    const parsed = JSON.parse(content);
    notes = Object.entries(parsed).map(([id, note]: [string, any]) => ({
      id,
      ...note,
    }));
  } else {
    notes = [];
  }
}

// Dashboard: list notes + form
router.get('/', () => {
  const noteList = notes.map(
    note => `<li><a href="/notes/${note.id}">${escapeHtml(note.title)}</a></li>`
  ).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Notes Dashboard</title></head>
    <body>
      <h1>All Notes</h1>
      <ul>${noteList}</ul>

      <h2>Create a New Note</h2>
      <form id="noteForm">
        <p><label>Title:<br><input type="text" name="title" required></label></p>
        <p><label>Content:<br><textarea name="content" rows="6" required></textarea></label></p>
        <p><label>Password:<br><input type="password" name="password" required></label></p>
        <button type="submit">Submit</button>
      </form>

      <p id="result"></p>

      <script>
        function escapeHtml(text) {
          return text.replace(/[&<>"']/g, function(m) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
          });
        }

        document.getElementById('noteForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const data = {
            title: form.title.value,
            content: form.content.value,
            password: form.password.value
          };

          const res = await fetch('/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });

          const result = document.getElementById('result');
          if (res.ok) {
            const json = await res.json();
            result.innerHTML = '✅ Note created: <a href="/notes/' + json.id + '">' + escapeHtml(json.title) + '</a>';
            form.reset();
            // Optionally reload page or update note list dynamically
          } else {
            result.textContent = '❌ Error: ' + res.status;
          }
        });
      </script>
    </body>
    </html>
  `;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Show note content only if User-Agent includes "roblox" (case-insensitive)
router.get('/notes/:id', (req, env: Env) => {
  const id = req.params.id;
  const note = notes.find(n => n.id === id);

  if (!note) {
    return new Response('Note not found', { status: 404 });
  }

  const userAgent = req.headers.get('User-Agent') || '';
  const allowed = userAgent.toLowerCase().includes('roblox');

  if (!allowed) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>${escapeHtml(note.title)}</title></head>
      <body>
        <h1>${escapeHtml(note.title)}</h1>
        <p>Content hidden</p>
        <p><a href="/">Back</a></p>
      </body>
      </html>
    `;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  // Show content as plaintext (escape HTML)
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>${escapeHtml(note.title)}</title></head>
    <body>
      <h1>${escapeHtml(note.title)}</h1>
      <pre>${escapeHtml(note.content)}</pre>
      <p><a href="/">Back</a></p>
    </body>
    </html>
  `;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

router.post('/notes', async (req, env: Env) => {
  try {
    const body = await req.json();

    if (body.password !== env.NOTES_POST_PASSWORD) {
      return new Response('Unauthorized', { status: 401 });
    }

    let { title, content } = body;

    if (isRobloxScript(content)) {
      content = await obfuscate(content);
    } else {
      content = await filterText(content);
    }

    const newNote: Note = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };

    notes.push(newNote);
    await storeNotesInGithubFile(env, notes);

    return new Response(JSON.stringify(newNote), {
      headers: { 'Content-Type': 'application/json' },
      status: 201,
    });
  } catch (e) {
    return new Response(`Error: ${(e as Error).message}`, { status: 500 });
  }
});

// Simple HTML escape helper
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env); // Load notes on every request
    return router.handle(request, env, ctx);
  },
};
