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

function renderDashboard(notes: Note[], message = '') {
  const list = notes
    .map(n => `<li><a href="/notes/${n.id}">${n.title}</a></li>`)
    .join('\n');
  return `
    <html>
      <head><title>Notes Dashboard</title></head>
      <body>
        <h1>Notes</h1>
        ${message ? `<p style="color:green">${message}</p>` : ''}
        <ul>${list}</ul>
        <hr/>
        <h2>Add a new note</h2>
        <form method="POST" action="/notes">
          <label>Title: <input name="title" required /></label><br/>
          <label>Content:<br/>
            <textarea name="content" rows="6" cols="40" required></textarea>
          </label><br/>
          <label>Password: <input name="password" type="password" required /></label><br/>
          <button type="submit">Add Note</button>
        </form>
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
  } else {
    notes = [];
  }
}

// ROUTES

router.get('/', async (req, env) => {
  await loadNotesFromGithub(env);
  const html = renderDashboard(notes);
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

router.get('/notes/:id', async (req, env) => {
  await loadNotesFromGithub(env);

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop()!;
  const note = notes.find(n => n.id === id);

  if (!note) return new Response('Note not found', { status: 404 });

  const ua = req.headers.get('User-Agent') || '';
  const isAllowedUserAgent = ua.toLowerCase().includes('roblox');

  if (isAllowedUserAgent) {
    return new Response(note.content, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(renderHTML(note.title, 'Content hidden'), {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.post('/notes', async (req, env) => {
  // Support form submission (x-www-form-urlencoded)
  const contentType = req.headers.get('Content-Type') || '';
  let formData: URLSearchParams | null = null;
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formText = await req.text();
    formData = new URLSearchParams(formText);
  } else {
    // fallback to JSON body
    try {
      const json = await req.json();
      formData = new URLSearchParams(Object.entries(json));
    } catch {
      formData = null;
    }
  }

  if (!formData) return new Response('Invalid request body', { status: 400 });

  const password = formData.get('password') || '';
  if (password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  const title = formData.get('title') || '';
  const content = formData.get('content') || '';

  if (!title || !content) {
    return new Response('Missing title or content', { status: 400 });
  }

  const newNote: Note = {
    id: crypto.randomUUID(),
    title,
    content,
    createdAt: new Date().toISOString(),
  };

  await loadNotesFromGithub(env); // refresh notes before pushing
  notes.push(newNote);
  await storeNotesInGithubFile(env, notes);

  // After posting redirect back to / with a success message
  return new Response(null, {
    status: 303,
    headers: { Location: '/?message=Note+added' },
  });
});

// EXPORT fetch handler

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return router.handle(request, env, ctx);
  },
};
