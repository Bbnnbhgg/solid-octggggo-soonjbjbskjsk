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

// Detect Roblox script for obfuscation
const isRobloxScript = (content: string) =>
  content.includes('game') || content.includes('script');

// Obfuscate Roblox script via external API
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

// Filter non-script text via external API
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

// Load notes from GitHub file
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

// Store updated notes to GitHub file
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

// --- ROUTES ---

// Dashboard shows list of note titles as links
router.get('/', async (req, env: Env) => {
  await loadNotesFromGithub(env);

  let message = '';
  try {
    const url = new URL(req.url);
    message = url.searchParams.get('message') || '';
  } catch {}

  const html = `
  <html>
    <head><title>Notes Dashboard</title></head>
    <body>
      <h1>Notes</h1>
      ${message ? `<p style="color:green">${message}</p>` : ''}
      <ul>
        ${notes
          .map((note) => `<li><a href="/notes/${note.id}">${escapeHtml(note.title)}</a></li>`)
          .join('\n')}
      </ul>
      <p><a href="/post">Add a Note</a></p>
    </body>
  </html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Show note content only if user-agent includes keyword, else show "Content hidden"
router.get('/notes/:id', async (req, env: Env) => {
  await loadNotesFromGithub(env);
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();
  if (!id) return new Response('Not found', { status: 404 });

  const note = notes.find((n) => n.id === id);
  if (!note) return new Response('Not found', { status: 404 });

  const userAgent = req.headers.get('user-agent') || '';
  const allowed = userAgent.toLowerCase().includes('roblox');

  const contentToShow = allowed ? escapeHtml(note.content) : 'Content hidden';

  const html = `
  <html>
    <head><title>${escapeHtml(note.title)}</title></head>
    <body>
      <h1>${escapeHtml(note.title)}</h1>
      <pre>${contentToShow}</pre>
      <p><a href="/">Back to Notes</a></p>
    </body>
  </html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Show HTML form for posting a new note
router.get('/post', (_req) => {
  const html = `
  <html>
    <head><title>Add Note</title></head>
    <body>
      <h1>Add a Note</h1>
      <form method="POST" action="/notes">
        <label>Title: <input name="title" required></label><br>
        <label>Content:<br><textarea name="content" rows="10" cols="50" required></textarea></label><br>
        <label>Password: <input name="password" type="password" required></label><br>
        <button type="submit">Add Note</button>
      </form>
      <p><a href="/">Back to Notes</a></p>
    </body>
  </html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Handle note POST form submission
router.post('/notes', async (req, env: Env) => {
  // Parse form data
  const formData = await req.formData();
  const title = formData.get('title');
  const content = formData.get('content');
  const password = formData.get('password');

  if (
    typeof title !== 'string' ||
    typeof content !== 'string' ||
    typeof password !== 'string'
  ) {
    return new Response('Bad Request: Missing fields', { status: 400 });
  }

  if (password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  let processedContent = content;

  if (isRobloxScript(content)) {
    processedContent = await obfuscate(content);
  } else {
    processedContent = await filterText(content);
  }

  await loadNotesFromGithub(env);

  const newNote: Note = {
    id: crypto.randomUUID(),
    title,
    content: processedContent,
    createdAt: new Date().toISOString(),
  };

  notes.push(newNote);
  await storeNotesInGithubFile(env, notes);

  // Redirect back to dashboard with success message
  return new Response(null, {
    status: 303,
    headers: { Location: '/?message=Note+added+successfully' },
  });
});

// Escape HTML helper
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Main fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx);
  },
};
