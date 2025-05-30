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

    const rawText = await res.text();
    console.log('DEBUG: Obfuscator raw response:', rawText);

    if (!res.ok) {
      console.log('DEBUG: Obfuscator request failed with status', res.status);
      return content;
    }

    try {
      const data = JSON.parse(rawText);
      return data.obfuscated || content;
    } catch (err) {
      console.log('DEBUG: Failed to parse obfuscator response as JSON');
      return content;
    }
  } catch (err) {
    console.log('DEBUG: Obfuscator fetch threw error:', err);
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
  console.log('DEBUG: Stored notes successfully');
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
    console.log(`DEBUG: Loaded ${notes.length} notes from GitHub`);
  } else {
    console.log('DEBUG: Failed to load notes from GitHub, status:', res.status);
    notes = [];
  }
}

// Escape HTML helper
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Routes

// Dashboard - list titles only with links and post form
router.get('/', async () => {
  let listHtml = notes
    .map(
      (note) =>
        `<li><a href="/notes/${note.id}">${escapeHtml(note.title)}</a></li>`
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><title>Notes Dashboard</title></head>
<body>
  <h1>Notes</h1>
  <ul>${listHtml}</ul>
  <h2>Post a new note</h2>
  <form method="POST" action="/notes">
    <label>Title: <input name="title" required /></label><br/>
    <label>Content:<br/><textarea name="content" rows="10" cols="50" required></textarea></label><br/>
    <label>Password: <input name="password" type="password" required /></label><br/>
    <button type="submit">Post Note</button>
  </form>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// View single note - content shown only if User-Agent contains "roblox" (case-insensitive)
router.get('/notes/:id', (request, env) => {
  const { id } = request.params!;
  const note = notes.find((n) => n.id === id);

  if (!note) {
    return new Response('Note not found', { status: 404 });
  }

  const ua = request.headers.get('User-Agent') || '';
  const allowed = ua.toLowerCase().includes('roblox');

  const content = allowed ? note.content : 'Content hidden';

  const html = `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(note.title)}</title></head>
<body>
  <h1>${escapeHtml(note.title)}</h1>
  <pre>${escapeHtml(content)}</pre>
  <p><a href="/">Back</a></p>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// POST new note from JSON or form
router.post('/notes', async (request, env: Env) => {
  let body: any = {};
  const ct = request.headers.get('Content-Type') || '';

  if (ct.includes('application/json')) {
    body = await request.json();
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    body.title = formData.get('title')?.toString() || '';
    body.content = formData.get('content')?.toString() || '';
    body.password = formData.get('password')?.toString() || '';
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
  } catch (err) {
    console.log('DEBUG: Failed to store notes:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  // Redirect back to dashboard after form submit
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Response.redirect('/', 303);
  }

  return new Response(JSON.stringify(newNote), {
    headers: { 'Content-Type': 'application/json' },
    status: 201,
  });
});

// Main fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env);
    return router.handle(request, env, ctx);
  },
};
