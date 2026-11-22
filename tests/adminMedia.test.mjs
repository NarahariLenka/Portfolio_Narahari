/**
 * Phase F — Media Library: file validation (size, extension, declared type, real content),
 * safe unique paths, upload responses, listing/filtering, reference detection and safe
 * deletion, against fake Storage / XMLHttpRequest (no network, nothing uploaded or deleted).
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let M, A, R
before(async () => {
  ;[M, A, R] = await loadModules(['/src/admin/media/mediaModel.ts', '/src/admin/media/mediaApi.ts', '/src/data/remote.ts'])
})
after(closeModules)

const quiet = async (fn) => {
  const w = console.warn
  console.warn = () => {}
  try { return await fn() } finally { console.warn = w }
}
const bytes = (...parts) => {
  const out = []
  for (const p of parts) {
    if (typeof p === 'string') out.push(...[...p].map((c) => c.charCodeAt(0)))
    else out.push(...p)
  }
  while (out.length < 32) out.push(0)
  return new Uint8Array(out)
}
const HEAD = {
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0]),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: bytes('RIFF', [0, 0, 0, 0], 'WEBP'),
  avif: bytes([0, 0, 0, 0x20], 'ftypavif'),
  pdf: bytes('%PDF-1.7'),
  gif: bytes('GIF89a'),
  svg: bytes('<svg xmlns'),
  html: bytes('<!doctype html>'),
}
const info = (name, size = 1000, type = '') => ({ name, size, type })

// ---------------------------------------------------------------------------- validation

describe('file validation', () => {
  test('accepts the bucket’s five types when name, declared type and content agree', () => {
    const ok = [
      [info('photo.jpg', 1000, 'image/jpeg'), HEAD.jpeg, 'projects'],
      [info('photo.JPEG'), HEAD.jpeg, 'portrait'],
      [info('shot.png', 1000, 'image/png'), HEAD.png, 'projects'],
      [info('shot.webp', 1000, 'image/webp'), HEAD.webp, 'projects'],
      [info('shot.avif', 1000, 'image/avif'), HEAD.avif, 'certificates'],
      [info('cert.pdf', 1000, 'application/pdf'), HEAD.pdf, 'certificates'],
      [info('legacy.jpg', 1000, 'image/jpg'), HEAD.jpeg, 'projects'],
    ]
    for (const [f, h, folder] of ok) assert.equal(M.fileProblem(f, h, folder), null, f.name)
  })

  test('rejects unsupported types, spoofed content, wrong extensions, empty and oversized files', () => {
    const bad = [
      [info('anim.gif', 1000, 'image/gif'), HEAD.gif, /Unsupported/],
      [info('logo.svg', 1000, 'image/svg+xml'), HEAD.svg, /Unsupported/],
      [info('page.html'), HEAD.html, /Unsupported/],
      [info('noext'), HEAD.png, /Unsupported/],
      [info('fake.png', 1000, 'image/png'), HEAD.html, /isn’t a valid/],
      [info('fake.jpg', 1000, 'image/jpeg'), HEAD.png, /content is image\/png/],
      [info('a.png', 1000, 'image/jpeg'), HEAD.png, /says it is image\/jpeg/],
      [info('empty.png', 0, 'image/png'), HEAD.png, /empty/],
      [info('big.png', M.MAX_BYTES + 1, 'image/png'), HEAD.png, /Too large/],
      [info('cert.pdf', 1000, 'application/pdf'), HEAD.pdf, /PDFs belong in Certificates/],
    ]
    for (const [f, h, re] of bad) assert.match(M.fileProblem(f, h, f.name === 'cert.pdf' ? 'projects' : 'projects') ?? '', re, f.name)
    assert.equal(M.fileProblem(info('max.png', M.MAX_BYTES, 'image/png'), HEAD.png, 'projects'), null, 'exactly 10 MB is allowed')
  })

  test('limits match the bucket definition (10 MB; JPEG, PNG, WebP, AVIF, PDF)', () => {
    assert.equal(M.MAX_BYTES, 10485760)
    assert.deepEqual(Object.keys(M.TYPES).sort(), ['application/pdf', 'image/avif', 'image/jpeg', 'image/png', 'image/webp'])
  })
})

describe('safe, unique upload paths', () => {
  test('folder conventions, safe names and a random part', () => {
    assert.match(M.uploadPath('projects', 'My Shot (final).PNG', 'image/png', 'abc123'), /^projects\/my-shot-final-abc123\.png$/)
    assert.equal(M.uploadPath('portrait', 'me.jpeg', 'image/jpeg', 'x1y2z3'), 'portrait/me-x1y2z3.jpg')
    assert.equal(M.uploadPath('certificates', 'AWS Cert.pdf', 'application/pdf', 'q'), 'certificates/pdfs/aws-cert-q.pdf')
    assert.equal(M.uploadPath('certificates', 'aws.webp', 'image/webp', 'q'), 'certificates/images/aws-q.webp')
  })

  test('path tricks in names never escape the folder', () => {
    for (const name of ['../../etc/passwd.png', '..\\..\\x.png', '/abs/x.png', 'https://evil.com/x.png', '%2e%2e/x.png', '名前.png', '   .png', '.hidden.png']) {
      const p = M.uploadPath('projects', name, 'image/png', 'r4nd0m')
      assert.match(p, /^projects\/[a-z0-9-]+-r4nd0m\.png$/, name)
      assert.equal(R.safeMediaPath(p), p, 'accepted by the public site’s path rule')
    }
  })

  test('two uploads of the same file name get different paths', () => {
    const a = M.uploadPath('projects', 'x.png', 'image/png')
    const b = M.uploadPath('projects', 'x.png', 'image/png')
    assert.notEqual(a, b)
  })
})

describe('upload response classification', () => {
  test('Storage answers', () => {
    assert.equal(M.classifyUpload(200, { Key: 'x' }), 'ok')
    assert.equal(M.classifyUpload(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), 'duplicate')
    assert.equal(M.classifyUpload(409, null), 'duplicate')
    assert.equal(M.classifyUpload(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }), 'denied')
    assert.equal(M.classifyUpload(413, { error: 'Payload too large' }), 'too-large')
    assert.equal(M.classifyUpload(400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type image/gif is not supported' }), 'type')
    assert.equal(M.classifyUpload(400, { statusCode: '400', error: 'InvalidJWT', message: 'jwt expired' }), 'expired')
    assert.equal(M.classifyUpload(500, { error: 'internal' }), 'error')
  })
})

// ---------------------------------------------------------------------------- browse

const file = (path, extra = {}) => ({ path, name: path.split('/').pop(), folder: M.folderOf(path), size: 1000, mime: /\.pdf$/.test(path) ? 'application/pdf' : 'image/webp', kind: M.kindOf(null, path), updatedAt: '2026-11-01T00:00:00Z', ...extra })

describe('search and filters', () => {
  test('folder, type and filename search combine; newest first', () => {
    const files = [file('projects/retinax-a.webp', { updatedAt: '2026-11-03' }), file('portrait/me-b.jpg'), file('certificates/images/aws-c.png'), file('certificates/pdfs/aws-d.pdf', { updatedAt: '2026-11-05' })]
    assert.equal(M.filterMedia(files, { folder: 'all', kind: 'all', query: '' }).length, 4)
    assert.deepEqual(M.filterMedia(files, { folder: 'certificates', kind: 'all', query: '' }).map((f) => f.name), ['aws-d.pdf', 'aws-c.png'])
    assert.deepEqual(M.filterMedia(files, { folder: 'certificates', kind: 'image', query: '' }).map((f) => f.name), ['aws-c.png'])
    assert.deepEqual(M.filterMedia(files, { folder: 'all', kind: 'pdf', query: '' }).map((f) => f.name), ['aws-d.pdf'])
    assert.deepEqual(M.filterMedia(files, { folder: 'all', kind: 'all', query: '  RETINA ' }).map((f) => f.name), ['retinax-a.webp'])
    assert.deepEqual(M.filterMedia(files, { folder: 'portrait', kind: 'all', query: 'aws' }), [])
  })
})

// ---------------------------------------------------------------------------- references

const row = (extra) => ({ id: `id-${Math.random()}`, status: 'published', is_visible: true, sort_order: 10, created_at: '', updated_at: '', ...extra })
const snapWith = (o) => ({ sections: [{ id: 'home-id', slug: 'home' }], blocks: [], skills: [], projects: [], certificates: [], social_links: [], ...o })

describe('reference detection and safe deletion', () => {
  test('finds uses in the portrait block, projects and certificate pictures/PDFs, drafts included', () => {
    const s = snapWith({
      blocks: [row({ section_id: 'home-id', key: 'portrait', image_path: 'portrait/me.jpg', status: 'draft' })],
      projects: [row({ title: 'RetinaX', image_path: 'projects/r.webp' })],
      certificates: [row({ title: 'AWS', image_path: 'certificates/images/a.png', pdf_path: 'certificates/pdfs/a.pdf', status: 'draft' })],
    })
    assert.deepEqual(M.findReferences(s, 'portrait/me.jpg').map((r) => [r.label, r.status]), [['home · portrait', 'draft']])
    assert.equal(M.usageOf(M.findReferences(s, 'projects/r.webp')), 'published')
    assert.equal(M.usageOf(M.findReferences(s, 'certificates/pdfs/a.pdf')), 'draft')
    assert.equal(M.findReferences(s, 'certificates/images/a.png')[0].field, 'picture')
    assert.equal(M.usageOf(M.findReferences(s, 'projects/unused.webp')), 'unused')
  })

  test('deletion is refused for referenced files (draft or published) and outside the folders', () => {
    const s = snapWith({ projects: [row({ title: 'Draft one', image_path: 'projects/r.webp', status: 'draft' })] })
    assert.match(M.deleteProblem('projects/r.webp', M.findReferences(s, 'projects/r.webp')), /In use by 1 content item/)
    assert.equal(M.deleteProblem('projects/unused.webp', []), null)
    for (const p of ['other/x.png', '../x.png', '/projects/x.png', 'projects/../x.png']) assert.ok(M.deleteProblem(p, []), p)
  })
})

// ---------------------------------------------------------------------------- api

function fakeStorage({ tree = {}, listError = null, removeResult = null, session = true } = {}) {
  const calls = { list: [], remove: [] }
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: session ? { access_token: 'user-token' } : null } }) },
    storage: {
      from: (bucket) => ({
        list: async (prefix, opts) => {
          calls.list.push({ bucket, prefix, opts })
          if (listError) return { data: null, error: listError }
          return { data: tree[prefix] ?? [], error: null }
        },
        remove: async (paths) => {
          calls.remove.push({ bucket, paths })
          return removeResult ?? { data: [], error: null }
        },
        getPublicUrl: (p) => ({ data: { publicUrl: `https://x.test/${bucket}/${p}` } }),
      }),
    },
  }
}
const obj = (name, size = 10, mimetype = 'image/webp') => ({ name, id: `id-${name}`, updated_at: '2026-11-01', metadata: { size, mimetype } })
const dir = (name) => ({ name, id: null, metadata: null })

describe('listMedia', () => {
  test('walks the three folders and their subfolders; ignores placeholders and other folders', async () => {
    const sb = fakeStorage({
      tree: {
        portrait: [obj('me.jpg', 20, 'image/jpeg'), obj('.emptyFolderPlaceholder')],
        projects: [obj('r.webp')],
        certificates: [dir('images'), dir('pdfs')],
        'certificates/images': [obj('a.png', 5, 'image/png')],
        'certificates/pdfs': [obj('a.pdf', 7, 'application/pdf')],
        secret: [obj('never-listed.png')],
      },
    })
    const r = await A.listMedia(sb)
    assert.equal(r.kind, 'ok')
    assert.deepEqual(r.files.map((f) => f.path).sort(), ['certificates/images/a.png', 'certificates/pdfs/a.pdf', 'portrait/me.jpg', 'projects/r.webp'])
    assert.equal(r.files.find((f) => f.path.endsWith('.pdf')).kind, 'pdf')
    assert.ok(sb.calls.list.every((c) => c.bucket === 'portfolio-media'))
    assert.ok(!sb.calls.list.some((c) => c.prefix === 'secret' || c.prefix === ''))
  })

  test('empty bucket, expired session, refused and network errors', async () => {
    assert.deepEqual(await A.listMedia(fakeStorage()), { kind: 'ok', files: [], truncated: false })
    assert.equal((await quiet(() => A.listMedia(fakeStorage({ listError: { name: 'StorageApiError', status: 400, message: 'jwt expired' } })))).kind, 'expired')
    assert.equal((await quiet(() => A.listMedia(fakeStorage({ listError: { name: 'StorageApiError', status: 403, message: 'new row violates row-level security' } })))).kind, 'denied')
    assert.equal((await quiet(() => A.listMedia(fakeStorage({ listError: { name: 'StorageUnknownError', message: 'Failed to fetch' } })))).kind, 'network')
  })
})

/** Fake XMLHttpRequest that records the request and answers as told. */
function fakeXhr(answer) {
  const x = {
    headers: {}, method: null, url: null, body: null, timeout: 0, status: 0, responseText: '',
    upload: { onprogress: null }, onload: null, onerror: null, ontimeout: null, onabort: null,
    open(m, u) { x.method = m; x.url = u },
    setRequestHeader(k, v) { x.headers[k.toLowerCase()] = v },
    abort() { x.onabort?.() },
    send(body) {
      x.body = body
      queueMicrotask(() => answer(x))
    },
  }
  return x
}

describe('uploadFile', () => {
  const blob = new Blob([HEAD.png])

  test('authorised with the admin’s session token + publishable key; never overwrites; real progress', async () => {
    let xhr
    const progress = []
    const r = await A.uploadFile(fakeStorage(), { path: 'projects/x-abc.png', body: blob, contentType: 'image/png', onProgress: (f) => progress.push(f) }, () =>
      (xhr = fakeXhr((x) => {
        x.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
        x.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 })
        x.status = 200
        x.responseText = '{"Key":"portfolio-media/projects/x-abc.png"}'
        x.onload()
      })),
    )
    assert.deepEqual(r, { kind: 'ok', path: 'projects/x-abc.png' })
    assert.equal(xhr.method, 'POST')
    assert.match(xhr.url, /\/storage\/v1\/object\/portfolio-media\/projects\/x-abc\.png$/)
    assert.equal(xhr.headers.authorization, 'Bearer user-token')
    assert.equal(xhr.headers['x-upsert'], 'false')
    assert.equal(xhr.headers['content-type'], 'image/png')
    assert.ok(!xhr.headers.apikey.startsWith('sb_secret_'), 'never a secret key')
    assert.deepEqual(progress, [0.5, 1])
  })

  test('duplicate, refused (non-admin), too large, network error, cancel and no session', async () => {
    const answer = (status, body) => () => fakeXhr((x) => { x.status = status; x.responseText = JSON.stringify(body); x.onload() })
    const up = (make, opts = {}) => quiet(() => A.uploadFile(opts.sb ?? fakeStorage(), { path: opts.path ?? 'projects/x.png', body: blob, contentType: 'image/png', signal: opts.signal }, make))
    assert.equal((await up(answer(400, { statusCode: '409', error: 'Duplicate' }))).kind, 'duplicate')
    assert.equal((await up(answer(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }))).kind, 'denied')
    assert.equal((await up(answer(413, { error: 'Payload too large' }))).kind, 'too-large')
    assert.equal((await up(() => fakeXhr((x) => x.onerror()))).kind, 'network')
    const ctrl = new AbortController()
    const pending = up(() => fakeXhr(() => {}), { signal: ctrl.signal })
    ctrl.abort()
    assert.equal((await pending).kind, 'cancelled')
    let made = false
    assert.equal((await up(() => { made = true; return fakeXhr(() => {}) }, { sb: fakeStorage({ session: false }) })).kind, 'expired')
    assert.equal(made, false, 'nothing sent without a session')
    assert.equal((await up(() => { made = true; return fakeXhr(() => {}) }, { path: 'other/x.png' })).kind, 'denied')
    assert.equal(made, false, 'nothing sent outside the allowed folders')
  })
})

describe('deleteMedia', () => {
  test('success only when Storage reports the path deleted', async () => {
    const ok = fakeStorage({ removeResult: { data: [{ name: 'projects/x.webp', bucket_id: 'portfolio-media' }], error: null } })
    assert.deepEqual(await A.deleteMedia(ok, 'projects/x.webp'), { kind: 'deleted' })
    assert.deepEqual(ok.calls.remove, [{ bucket: 'portfolio-media', paths: ['projects/x.webp'] }], 'one path at a time')
    assert.deepEqual(await A.deleteMedia(fakeStorage(), 'projects/x.webp'), { kind: 'not-deleted' }, 'refused by policy = empty list')
    assert.equal((await quiet(() => A.deleteMedia(fakeStorage({ removeResult: { data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } } }), 'projects/x.webp'))).kind, 'network')
    const sb = fakeStorage()
    assert.equal((await A.deleteMedia(sb, 'secret/x.png')).kind, 'denied')
    assert.equal(sb.calls.remove.length, 0, 'never sent outside the allowed folders')
  })
})
