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
    console.log("DEBUG: Sending script to obfuscator:", content.slice(0, 100));

    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: content }),
    });

    const text = await res.text();
    console.log("DEBUG: Obfuscator raw response:", text);

    if (!res.ok) {
      console.log("DEBUG: Obfuscator returned non-OK status:", res.status);
      return content;
    }

    const data = JSON.parse(text);
    return data.obfuscated || content;
  } catch (err) {
    console.log("DEBUG: Obfuscate fetch failed:", err);
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

  console.log("DEBUG: Stored notes successfully");
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

router.get('/', () => {
  const html = `<!DOCTYPE html>
<html>
<head><title>Notes</title></head>
<body>
  <h1>All Notes</h1>
  <ul>
    ${notes
      .map(
        (note) => `<li><a href="/notes/${note.id}">${note.title}</a></li>`
      )
      .join('')}
  </ul>
  <h2>Create Note</h2>
  <form method="POST" action="/notes">
    <input name="title" placeholder="Title" required />
    <br />
    <textarea name="content" placeholder="Content" required></textarea>
    <br />
    <input name="password" placeholder="Password" required type="password" />
    <br />
    <button type="submit">Post</button>
  </form>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.get('/notes/:id', (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();
  const note = notes.find((n) => n.id === id);

  if (!note) return new Response('Not found', { status: 404 });

  const ua = req.headers.get('User-Agent') || '';
  const isAllowed = ua.toLowerCase().includes('roblox');

  const html = `<!DOCTYPE html>
<html>
<head><title>${note.title}</title></head>
<body>
  <h1>${note.title}</h1>
  ${isAllowed ? `<pre>${note.content}</pre>` : `<p>Content hidden</p>`}
  <p><a href="/">Back</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
});

router.post('/notes', async (req, env: Env) => {
  let body: any = {};

  if (req.headers.get('Content-Type')?.includes('application/json')) {
    body = await req.json();
  } else {
    const form = await req.formData();
    body = Object.fromEntries(form.entries());
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
  await storeNotesInGithubFile(env, notes);

  return new Response(null, {
    status: 303,
    headers: { Location: '/' },
  });
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env);
    return router.handle(request, env, ctx);
  },
};
