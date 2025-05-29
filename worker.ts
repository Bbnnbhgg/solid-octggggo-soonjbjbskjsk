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

function renderHTML(title: string, body: string) {
  return `
    <html>
      <head><title>${title}</title></head>
      <body>
        <h1>${title}</h1>
        <p>${body}</p>
        <p><a href="/">Back</a></p>
      </body>
    </html>`;
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
  }
}

// ROUTES

router.get('/', async (req, env) => {
  // Dashboard: list titles as links
  await loadNotesFromGithub(env);
  const list = notes
    .map(n => `<li><a href="/notes/${n.id}">${n.title}</a></li>`)
    .join('\n');
  const html = `
    <html>
      <head><title>Notes Dashboard</title></head>
      <body>
        <h1>Notes</h1>
        <ul>${list}</ul>
      </body>
    </html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

router.get('/notes/:id', async (req, env) => {
  await loadNotesFromGithub(env);

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop()!;
  const note = notes.find(n => n.id === id);

  if (!note) return new Response('Note not found', { status: 404 });

  const ua = req.headers.get('User-Agent') || '';
  const isAllowedUserAgent = ua.toLowerCase().includes('roblox'); // your special check

  if (isAllowedUserAgent) {
    // Return raw content as plain text
    return new Response(note.content, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Otherwise show HTML with content hidden
  return new Response(renderHTML(note.title, 'Content hidden'), {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.post('/notes', async (req, env) => {
  const body = await req.json();

  if (body.password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  let { title, content } = body;

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
});

// EXPORT fetch handler

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return router.handle(request, env, ctx);
  },
};
