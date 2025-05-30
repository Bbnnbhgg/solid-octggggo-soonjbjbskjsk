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

    const text = await res.text(); // try to get raw response
    try {
      const data = JSON.parse(text);
      return data.obfuscated || content;
    } catch {
      console.log('[obfuscate] Failed to parse JSON:', text);
      return content;
    }
  } catch (err) {
    console.log('[obfuscate] Fetch failed:', err);
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

    const data = await res.json();
    return data.filtered || text;
  } catch (err) {
    console.log('[filterText] Failed:', err);
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
    console.log('[storeNotesInGithubFile] GitHub PUT error:', text);
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
    console.log('[loadNotesFromGithub] Failed to fetch notes');
  }
}

// HTML rendering
function html(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// Routes

router.get('/', () => {
  const list = notes.map(note => `<li><a href="/notes/${note.id}">${note.title}</a></li>`).join('');
  return html('Notes', `<h1>Notes</h1><ul>${list}</ul>`);
});

router.get('/notes/:id', (req, env: Env) => {
  const note = notes.find(n => n.id === req.params.id);
  if (!note) return new Response('Not found', { status: 404 });

  const isAllowed = req.headers.get('user-agent')?.toLowerCase().includes('roblox');
  const content = isAllowed
    ? `<pre>${note.content}</pre>`
    : `<p>Content hidden</p>`;

  return html(note.title, `<h1>${note.title}</h1>${content}<p><a href="/">Back</a></p>`);
});

router.post('/notes', async (req, env: Env) => {
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
});

// Worker export
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env);
    return router.handle(request, env, ctx);
  },
};
