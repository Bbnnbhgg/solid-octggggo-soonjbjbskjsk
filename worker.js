export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Route: Home page (list notes + form)
    if (request.method === 'GET' && pathname === '/') {
      const notes = await loadNotesFromGithub(env);
      return renderHomePage(notes);
    }

    // Route: View single note
    if (request.method === 'GET' && pathname.startsWith('/notes/')) {
      const id = pathname.split('/notes/')[1];
      const notes = await loadNotesFromGithub(env);
      const note = notes.find(n => n.id === id);
      if (!note) return new Response('Note not found', { status: 404 });

      const ua = request.headers.get('User-Agent') || '';
      const isRoblox = ua.toLowerCase().includes('roblox');
      const content = isRoblox ? note.content : 'Content hidden';

      return renderNotePage(note.title, content);
    }

    // Route: Post new note
    if (request.method === 'POST' && pathname === '/notes') {
      const contentType = request.headers.get('content-type') || '';
      let formData;
      if (contentType.includes('application/x-www-form-urlencoded')) {
        formData = await request.formData();
      } else {
        return new Response('Unsupported Content-Type', { status: 415 });
      }

      const title = formData.get('title') || '';
      const content = formData.get('content') || '';
      const password = formData.get('password') || '';

      if (password !== env.NOTES_POST_PASSWORD) {
        return new Response('Unauthorized', { status: 401 });
      }

      const finalContent = await processContent(content);
      const note = {
        id: crypto.randomUUID(),
        title,
        content: finalContent,
        createdAt: new Date().toISOString()
      };

      const notes = await loadNotesFromGithub(env);
      notes.push(note);
      await storeNotesInGithubFile(env, notes);

      return Response.redirect('/', 302);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Helpers
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
      <h2>Post a new note</h2>
      <form method="POST" action="/notes">
        <label>Title: <input name="title" required /></label><br/>
        <label>Content:<br/><textarea name="content" rows="10" cols="50" required></textarea></label><br/>
        <label>Password: <input name="password" type="password" required /></label><br/>
        <button type="submit">Post Note</button>
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
    try {
      const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: text })
      });
      const data = await res.json();
      return data.obfuscated || text;
    } catch {
      return text;
    }
  } else {
    try {
      const res = await fetch('https://tiny-river-0235.hiplitehehe.workers.dev/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      return data.filtered || text;
    } catch {
      return text;
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
