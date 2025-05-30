import { Router } from 'itty-router';

const router = Router();

// View home page with notes and form
router.get('/', async (request, env) => {
  const notes = await loadNotesFromGithub(env);
  return renderHomePage(notes);
});

// View single note
router.get('/notes/:id', async ({ params, headers }, env) => {
  const notes = await loadNotesFromGithub(env);
  const note = notes.find(n => n.id === params.id);
  if (!note) return new Response('Note not found', { status: 404 });

  const ua = headers.get('User-Agent') || '';
  const isRoblox = ua.toLowerCase().includes('roblox');
  const content = isRoblox ? note.content : 'Content hidden';

  return renderNotePage(note.title, content);
});

// Create a new note (requires password)
router.post('/notes', async (request, env) => {
  const formData = await request.formData();
  const title = formData.get('title');
  const content = formData.get('content');
  const password = formData.get('password');

  if (!title || !content || !password) {
    return new Response('Title, content, and password are required.', { status: 400 });
  }

  if (password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  const notes = await loadNotesFromGithub(env);
  const id = crypto.randomUUID();

  try {
    const processed = await processContent(content);
    notes.push({ id, title, content: processed });
    await storeNotesInGithubFile(env, notes);
    return new Response(null, {
      status: 302,
      headers: { Location: `/notes/${id}` }
    });
  } catch (err) {
    return new Response(`Processing error: ${err.message}`, { status: 500 });
  }
});

// Catch-all
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  fetch: (request, env, ctx) => router.handle(request, env, ctx)
};

// ------------------ Helpers ------------------

function renderHomePage(notes) {
  const items = notes.map(n =>
    `<li><a href="/notes/${n.id}">${escapeHtml(n.title)}</a></li>`
  ).join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Notes</title></head>
    <body>
      <h1>Notes</h1>
      <ul>${items}</ul>

      <h2>Create New Note</h2>
      <form method="POST" action="/notes">
        <label>Title:<br><input name="title" required></label><br>
        <label>Content:<br><textarea name="content" rows="6" cols="40" required></textarea></label><br>
        <label>Password:<br><input name="password" type="password" required></label><br>
        <button type="submit">Create Note</button>
      </form>
    </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

function renderNotePage(title, content) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>${escapeHtml(title)}</title></head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(content)}</pre>
      <p><a href="/">Back</a></p>
    </body>
    </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

function isRobloxScript(text) {
  return text.includes('game') || text.includes('script');
}

async function processContent(text) {
  if (isRobloxScript(text)) {
    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: text })
    });

    const responseText = await res.text();

    if (!res.ok) {
      throw new Error(`Obfuscator API error ${res.status}: ${responseText}`);
    }

    try {
      const data = JSON.parse(responseText);
      return data.obfuscated || text;
    } catch {
      throw new Error(`Failed to parse obfuscator JSON: ${responseText}`);
    }

  } else {
    try {
      const res = await fetch('https://tiny-river-0235.hiplitehehe.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const responseText = await res.text();

      if (!res.ok) {
        throw new Error(`Filter API error ${res.status}: ${responseText}`);
      }

      const data = JSON.parse(responseText);
      return data.filtered || text;
    } catch (err) {
      throw new Error(`Filter failed: ${err.message}`);
    }
  }
}

async function loadNotesFromGithub(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesWorker/1.0'
    }
  });

  if (res.status === 200) {
    const data = await res.json();
    const decoded = atob(data.content);
    const parsed = JSON.parse(decoded);
    return Object.entries(parsed).map(([id, note]) => ({ id, ...note }));
  }

  return [];
}

async function storeNotesInGithubFile(env, notes) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`;

  const headers = {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    'User-Agent': 'MyNotesWorker/1.0',
    Accept: 'application/vnd.github.v3+json'
  };

  const getRes = await fetch(url, { headers });
  let sha = null;

  if (getRes.status === 200) {
    const data = await getRes.json();
    sha = data.sha;
  }

  const contentObj = {};
  for (const note of notes) {
    const { id, ...rest } = note;
    contentObj[id] = rest;
  }

  const payload = {
    message: 'Update notes',
    content: btoa(JSON.stringify(contentObj, null, 2)),
    branch: env.GITHUB_BRANCH
  };

  if (sha) payload.sha = sha;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  if (![200, 201].includes(putRes.status)) {
    const text = await putRes.text();
    throw new Error(`GitHub PUT failed: ${text}`);
  }
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
