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
let lastDebugMessage = ''; // for showing last debug info on note page

const isRobloxScript = (content: string) =>
  content.includes('game') || content.includes('script');

async function obfuscate(content: string): Promise<string> {
  try {
    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: content }),
    });
    if (!res.ok) {
      lastDebugMessage = `Obfuscate API error: ${res.status} ${await res.text()}`;
      return content;
    }
    const data = await res.json();
    lastDebugMessage = 'Obfuscate API success';
    return data.obfuscated || content;
  } catch (e: any) {
    lastDebugMessage = `Obfuscate fetch failed: ${e.message}`;
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
    if (!res.ok) {
      lastDebugMessage = `Filter API error: ${res.status} ${await res.text()}`;
      return text;
    }
    const data = await res.json();
    lastDebugMessage = 'Filter API success';
    return data.filtered || text;
  } catch (e: any) {
    lastDebugMessage = `Filter fetch failed: ${e.message}`;
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

// Routes

router.get('/', async () => {
  const notesList = notes.map(note => `<li><a href="/notes/${note.id}">${note.title}</a></li>`).join('');
  return new Response(`
    <html>
      <body>
        <h1>Notes Dashboard</h1>
        <ul>${notesList}</ul>
        <h2>New Note</h2>
        <form method="POST" action="/notes">
          <label>Title: <input type="text" name="title" required></label><br>
          <label>Content:<br><textarea name="content" rows="8" cols="40" required></textarea></label><br>
          <label>Password: <input type="password" name="password" required></label><br>
          <button type="submit">Add Note</button>
        </form>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' },
  });
});

// Show note content only if User-Agent includes "roblox" (case-insensitive)
router.get('/notes/:id', (request, env) => {
  const { id } = request.params;
  const note = notes.find(n => n.id === id);
  if (!note) {
    return new Response('Note not found', { status: 404 });
  }
  const userAgent = request.headers.get('user-agent') || '';
  const canSeeContent = userAgent.toLowerCase().includes('roblox');

  return new Response(`
    <html>
      <head><title>${note.title}</title></head>
      <body>
        <h1>${note.title}</h1>
        ${
          canSeeContent
            ? `<pre>${note.content}</pre>`
            : `<p>Content hidden</p>`
        }
        <p><a href="/">Back</a></p>
        <hr>
        <p><strong>DEBUG:</strong> ${lastDebugMessage}</p>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' },
  });
});

// Accept form-encoded POST requests (from the HTML form)
router.post('/notes', async (request, env) => {
  const contentType = request.headers.get('content-type') || '';
  let body: any = {};
  if (contentType.includes('application/json')) {
    body = await request.json();
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries());
  } else {
    return new Response('Unsupported content type', { status: 415 });
  }

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
  try {
    await storeNotesInGithubFile(env, notes);
    lastDebugMessage = 'Stored notes successfully';
  } catch (e: any) {
    lastDebugMessage = `Failed to store notes: ${e.message}`;
  }

  return new Response(`
    <html>
      <body>
        <h1>Note Added</h1>
        <p>Title: ${newNote.title}</p>
        <p><a href="/">Back to Dashboard</a></p>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' },
  });
});

// Main fetch handler

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env); // load notes fresh per request (optional)
    return router.handle(request, env, ctx);
  },
};
