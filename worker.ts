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
  }
}

// Dashboard: show list and form
router.get('/', () => {
  const html = `
    <html>
      <head><title>Notes</title></head>
      <body>
        <h1>Notes</h1>
        <ul>
          ${notes.map(n => `<li><a href="/notes/${n.id}">${n.title}</a></li>`).join('')}
        </ul>

        <h2>New Note</h2>
        <form method="post" action="/submit">
          <input type="text" name="title" placeholder="Title" required><br>
          <textarea name="content" placeholder="Content" rows="10" cols="50" required></textarea><br>
          <input type="password" name="password" placeholder="Password" required><br>
          <button type="submit">Post Note</button>
        </form>
      </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Individual note (only shows content if User-Agent includes 'Roblox')
router.get('/notes/:id', (req) => {
  const id = req.params?.id;
  const note = notes.find(n => n.id === id);
  if (!note) return new Response('Not found', { status: 404 });

  const userAgent = req.headers.get('User-Agent') || '';
  const showContent = userAgent.includes('Roblox');

  const html = `
    <html>
      <head><title>${note.title}</title></head>
      <body>
        <h1>${note.title}</h1>
        ${showContent ? `<pre>${note.content}</pre>` : `<p>Content hidden</p>`}
        <p><a href="/">Back</a></p>
      </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Handle HTML form submission
router.post('/submit', async (req, env: Env) => {
  const formData = await req.formData();
  const title = formData.get('title')?.toString() || '';
  const contentRaw = formData.get('content')?.toString() || '';
  const password = formData.get('password')?.toString();

  if (password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  const content = /game|script/.test(contentRaw)
    ? await obfuscate(contentRaw)
    : await filterText(contentRaw);

  const newNote: Note = {
    id: crypto.randomUUID(),
    title,
    content,
    createdAt: new Date().toISOString(),
  };

  notes.push(newNote);
  await storeNotesInGithubFile(env, notes);

  return Response.redirect('/', 302);
});

// Required fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env);
    return router.handle(request, env, ctx);
  },
};
