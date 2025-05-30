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

const isAllowedUserAgent = (userAgent: string | null) =>
  userAgent?.toLowerCase().includes('roblox') ?? false;

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
      console.log('[obfuscate] Failed:', await res.text());
      return content;
    }
    const data = await res.json();
    return data.obfuscated || content;
  } catch (e) {
    console.log('[obfuscate] Error:', e);
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
  } catch (e) {
    console.log('[filterText] Error:', e);
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
  }
}

// HTML helper functions

function renderForm() {
  return `
    <form method="POST" action="/notes" style="margin-top: 20px;">
      <label>Title: <input type="text" name="title" required></label><br><br>
      <label>Content:<br><textarea name="content" rows="10" cols="50" required></textarea></label><br><br>
      <label>Password: <input type="password" name="password" required></label><br><br>
      <button type="submit">Add Note</button>
    </form>
  `;
}

function renderDashboard(notes: Note[]) {
  const listItems = notes.map(note => `<li><a href="/notes/${note.id}">${note.title}</a></li>`).join('');
  return `
    <html>
      <head><title>Notes Dashboard</title></head>
      <body>
        <h1>Notes</h1>
        <ul>${listItems}</ul>
        ${renderForm()}
      </body>
    </html>
  `;
}

function renderNotePage(note: Note, canViewContent: boolean) {
  return `
    <html>
      <head><title>${note.title}</title></head>
      <body>
        <h1>${note.title}</h1>
        ${
          canViewContent
            ? `<pre>${note.content}</pre>`
            : '<p>Content hidden</p>'
        }
        <p><a href="/">Back</a></p>
        ${renderForm()}
      </body>
    </html>
  `;
}

// Routes

router.get('/', async (req, env) => {
  await loadNotesFromGithub(env);
  return new Response(renderDashboard(notes), {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.get('/notes/:id', async (req, env) => {
  await loadNotesFromGithub(env);
  const id = req.params.id;
  const note = notes.find(n => n.id === id);
  if (!note) {
    return new Response('Note not found', { status: 404 });
  }
  const userAgent = req.headers.get('user-agent');
  const canViewContent = isAllowedUserAgent(userAgent);
  return new Response(renderNotePage(note, canViewContent), {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.post('/notes', async (req, env) => {
  const contentType = req.headers.get('Content-Type') || '';
  let body: any;

  if (contentType.includes('application/json')) {
    body = await req.json();
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await req.formData();
    body = {
      title: formData.get('title'),
      content: formData.get('content'),
      password: formData.get('password'),
    };
  } else {
    return new Response('Unsupported Content-Type', { status: 415 });
  }

  if (body.password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  let { title, content } = body;

  if (typeof title !== 'string' || typeof content !== 'string') {
    return new Response('Invalid input', { status: 400 });
  }

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

  return new Response(
    `<!DOCTYPE html>
    <html>
      <head><title>Note Added</title></head>
      <body>
        <h1>Note Added Successfully</h1>
        <p><a href="/">Back to Dashboard</a></p>
      </body>
    </html>`,
    {
      headers: { 'Content-Type': 'text/html' },
      status: 201,
    }
  );
});

// Export the fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx);
  },
};
