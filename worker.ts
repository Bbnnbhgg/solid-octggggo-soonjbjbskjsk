import { Router } from 'itty-router'

export interface Env {
  GITHUB_TOKEN: string
  GITHUB_REPO_OWNER: string
  GITHUB_REPO_NAME: string
  GITHUB_BRANCH: string
  NOTES_POST_PASSWORD: string
}

interface Note {
  id: string
  title: string
  content: string
  createdAt: string
}

const router = Router()
let notes: Note[] = []

const isRobloxScript = (content: string) =>
  /game|script/i.test(content)

async function obfuscate(content: string): Promise<string> {
  try {
    const res = await fetch('https://broken-pine-ac7f.hiplitehehe.workers.dev/api/obfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: content }),
    })
    const data = await res.json()
    return data.obfuscated || content
  } catch {
    return content
  }
}

async function loadNotesFromGithub(env: Env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  })

  if (res.ok) {
    const data = await res.json()
    const decoded = atob(data.content)
    const parsed = JSON.parse(decoded)
    notes = Object.entries(parsed).map(([id, note]: [string, any]) => ({
      id,
      ...note,
    }))
  }
}

async function storeNotesInGithubFile(env: Env, updatedNotes: Note[]) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents/notes.json`
  let sha: string | undefined

  const getRes = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'MyNotesApp/1.0',
    },
  })
  if (getRes.ok) {
    const existing = await getRes.json()
    sha = existing.sha
  }

  const notesObject = updatedNotes.reduce<Record<string, Omit<Note, 'id'>>>((acc, note) => {
    const { id, ...rest } = note
    acc[id] = rest
    return acc
  }, {})

  const encoded = btoa(JSON.stringify(notesObject, null, 2))

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
  })

  if (!putRes.ok) {
    const text = await putRes.text()
    throw new Error(`GitHub API error: ${text}`)
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
  `
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
})

router.get('/notes/:id', (req, env, ctx) => {
  const note = notes.find(n => n.id === req.params.id)
  if (!note) return new Response('Not found', { status: 404 })

  const userAgent = req.headers.get('user-agent') || ''
  const isRoblox = /roblox/i.test(userAgent)

  if (!isRoblox) {
    const html = `
      <html>
        <head><title>${note.title}</title></head>
        <body>
          <h1>${note.title}</h1>
          <p>Content hidden</p>
          <p><a href="/">Back</a></p>
        </body>
      </html>
    `
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }

  return new Response(note.content, {
    headers: { 'Content-Type': 'text/plain' }
  })
})

router.post('/notes', async (req, env) => {
  const contentType = req.headers.get('content-type') || ''
  let data: any = {}

  if (contentType.includes('application/json')) {
    data = await req.json()
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData()
    for (const [key, val] of form.entries()) {
      data[key] = val
    }
  }

  if (data.password !== env.NOTES_POST_PASSWORD) {
    return new Response('Unauthorized', { status: 401 })
  }

  let { title, content } = data

  if (isRobloxScript(content)) {
    content = await obfuscate(content)
  }

  const newNote: Note = {
    id: crypto.randomUUID(),
    title,
    content,
    createdAt: new Date().toISOString(),
  }

  notes.push(newNote)
  await storeNotesInGithubFile(env, notes)

  return new Response('OK', { status: 201 })
})

// Worker entry
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await loadNotesFromGithub(env)
    return router.handle(request, env, ctx)
  },
}
