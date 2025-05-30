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
  /game|script/i.test(content);

async function obfuscate(content: string): Promise<string> {
  console.log('[obfuscate] Starting obfuscation...');
  try {
    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: content }),
    });
    const data = await res.json();
    console.log('[obfuscate] Result:', data);
    return data.obfuscated || content;
  } catch (err) {
    console.log('[obfuscate] Failed:', err);
    return content;
  }
}

async function loadNotesFromGithub(env: Env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;
  console.log('[loadNotesFromGithub] Fetching notes...');
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  });

  if (res.ok) {
    const data = await res.json();
    const decoded = atob(data.content);
    const parsed = JSON.parse(decoded);
    notes = Object.entries(parsed).map(([id, note]: [string, any]) => ({
      id,
      ...note,
    }));
    console.log(`[loadNotesFromGithub] Loaded ${notes.length} notes`);
  } else {
    console.log('[loadNotesFromGithub] Failed to fetch notes:', res.status);
  }
}

async function storeNotesInGithubFile(env: Env, updatedNotes: Note[]) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;
  let sha: string | undefined;

  console.log('[storeNotesInGithubFile] Saving notes...');

  const getRes = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
    console.log('[storeNotesInGithubFile] Found existing notes, sha:', sha);
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

  const resultText = await putRes.text();
  console.log('[storeNotesInGithubFile] PUT result:', resultText);

  if (!putRes.ok) {
    throw new Error(`GitHub API error: ${resultText}`);
  }
}

// Routes

router.get('/', () => {
  const html = `
    <html>
      <head><title>Notes</title></head>
      <body>
        <h1>Notes</h1>
        <ul>
          ${notes.map(n => `<li><a href="/notes/${n.id}">${n.title}</a></li>`).join('')}
        </ul>
        <form method="POST" action="/notes">
          <input name="password" placeholder="Password" />
          <input name="title" placeholder="Title" />
          <textarea name="content" placeholder="Script"></textarea>
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

router.get('/notes/:id', (req) => {
  const note = notes.find(n => n.id === req.params.id);
  if (!note) return new Response('Not found', { status: 404 });

  const userAgent = req.headers.get('user-agent') || '';
  const allowView = /roblox/i.test(userAgent);

  console.log(`[GET /notes/${req.params.id}] UA="${userAgent}" => allowView=${allowView}`);

  if (!allowView) {
    return new Response(
      `<html><head><title>${note.title}</title></head><body><h1>${note.title}</h1><p>Content hidden</p><p><a href="/">Back</a></p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  return new Response(note.content, { headers: { 'Content-Type': 'text/plain' } });
});

router.post('/notes', async (req, env) => {
  const contentType = req.headers.get('content-type') || '';
  let data: any = {};

  if (contentType.includes('application/json')) {
    data = await req.json();
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    for (const [key, val] of form.entries()) data[key] = val;
  }

  if (data.password !== env.NOTES_POST_PASSWORD) {
    console.log('[POST /notes] Unauthorized');
    return new Response('Unauthorized', { status: 401 });
  }

  let { title, content } = data;
  console.log('[POST /notes] Received title:', title);

  if (isRobloxScript(content)) {
    console.log('[POST /notes] Detected Roblox script, obfuscating...');
    content = await obfuscate(content);
  }

  const newNote: Note = {
    id: crypto.randomUUID(),
    title,
    content,
    createdAt: new Date().toISOString(),
  };

  notes.push(newNote);
  console.log('[POST /notes] Storing note with ID:', newNote.id);
  await storeNotesInGithubFile(env, notes);

  return new Response('OK', { status: 201 });
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    console.log('[fetch] Request:', request.method, request.url);
    await loadNotesFromGithub(env);
    return router.handle(request, env, ctx);
  },
};
