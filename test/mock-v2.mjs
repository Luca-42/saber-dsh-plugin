/**
 * Mock-v2 integration test: runs the P1 tools against an in-process imitation
 * of the `/api/v2` contract, so the adapter, write payloads, and rendering can
 * be verified before the real 3.5.x binary is installed.
 *
 * Usage: node test/mock-v2.mjs
 */

import http from 'node:http'
import { existsSync } from 'node:fs'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const book = {
  id: 'b1',
  title: '夜缚',
  chapterCount: 1,
  pageCount: 2,
  updatedAt: '2026-11-08T04:00:00Z',
  tags: [],
  jobStatusSummary: { queued: 0, running: 0, paused: 0, interrupted: 0, failed: 0 },
}
const chapter = { id: 'c1', bookId: 'b1', ordinal: 1, title: '8', pageCount: 2, jobStatusSummary: {} }
const page = {
  id: 'p1',
  chapterId: 'c1',
  ordinal: 1,
  sourceRevision: 1,
  documentRevision: 1,
  renderedRevision: 1,
  renderStatus: 'ready',
  detectionState: 'processed',
  sourceUrl: '/api/v2/pages/p1/source.png',
  thumbnailSourceUrl: '/api/v2/pages/p1/thumb.png',
  cleanUrl: '/api/v2/pages/p1/clean.png',
  translatedUrl: '/api/v2/pages/p1/translated.png',
  width: 800,
  height: 1200,
}
const job = {
  jobId: 'j1',
  batchId: 'bat1',
  batchDisplayName: '夜缚 第1章',
  kind: 'translation',
  retryOfJobId: null,
  retryMode: null,
  status: 'running',
  queueRank: 1,
  bookId: 'b1',
  chapterId: 'c1',
  pageId: null,
  blockedReason: null,
  blockedByJobId: null,
  progress: {
    executionMode: 'sequential',
    jobStatus: 'running',
    totalItems: 2,
    completedItems: 1,
    failedItems: 0,
    skippedItems: 0,
    cancelledItems: 0,
    pools: [],
  },
  target: {},
  createdAt: '2026-11-08T04:00:00Z',
  startedAt: '2026-11-08T04:00:05Z',
  finishedAt: null,
}

const state = { requests: [] }

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  response.end(payload)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const path = url.pathname
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    state.requests.push({ method: request.method, path, query: url.search, body, headers: request.headers })
    const method = request.method ?? 'GET'

    if (method === 'GET' && path === '/api/v2/health') return json(response, 200, { status: 'ok', storageVersion: '3.5.2', role: 'api' })
    if (method === 'GET' && path === '/api/v2/system/server-info') return json(response, 200, { hostname: 'mock', host: '127.0.0.1', port: 0, lanUrl: null })
    if (method === 'GET' && path === '/api/v2/books') return json(response, 200, { items: [book] })
    if (method === 'GET' && path === '/api/v2/books/b1') return json(response, 200, { ...book, chapters: [chapter], tags: [] })
    if (method === 'GET' && path === '/api/v2/books/b1/chapters') return json(response, 200, { book, chapters: [chapter] })
    if (method === 'GET' && path === '/api/v2/chapters/c1/pages') return json(response, 200, { items: [page], nextCursor: null, pageOrderRevision: 1 })
    if (method === 'GET' && path === '/api/v2/pages/p1') return json(response, 200, page)
    if (method === 'GET' && path === '/api/v2/pages/p1/translated.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG_1PX.length })
      return response.end(PNG_1PX)
    }
    if (method === 'GET' && path === '/api/v2/jobs') {
      return json(response, 200, { items: [job], queuePaused: false, eventCursor: 1, workerOnline: true, executorBusy: false, waitingReason: null })
    }
    if (method === 'GET' && path === '/api/v2/jobs/j1') {
      return json(response, 200, {
        ...job,
        counts: { total: 2, pending: 0, running: 1, completed: 1, failed: 0, skipped: 0, cancelled: 0 },
        durationMs: 5000,
        error: null,
        configSummary: {},
        items: [],
        failedItems: [],
        artifacts: [],
        recentEvents: [],
      })
    }
    if (method === 'POST' && path === '/api/v2/chapters/c1/translation-jobs') {
      return json(response, 202, { batchId: 'bat1', jobIds: ['j1'], status: 'queued' })
    }
    if (method === 'POST' && path === '/api/v2/jobs/j1/pause') {
      return json(response, 200, { jobId: 'j1', status: 'paused' })
    }
    if (method === 'POST' && path === '/api/v2/jobs/j1/resume') {
      return json(response, 200, { jobId: 'j1', status: 'queued' })
    }
    if (method === 'GET' && path === '/api/v2/books/b1/translation-constraints') {
      return json(response, 200, {
        bookId: 'b1',
        revision: 3,
        payload: {
          glossary: { enabled: true, autoExtractEnabled: false, autoExtractPrompt: '', entries: [{ source: '夜', target: '夜' }] },
          nonTranslate: { enabled: true, entries: [{ text: 'SFX' }] },
        },
      })
    }
    if (method === 'GET' && path === '/api/server-info') {
      return json(response, 200, { success: true, port: 5000 })
    }
    return json(response, 404, { error: { message: `mock: no route ${method} ${path}` } })
  })
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`
process.env.SABER_BASE_URL = baseUrl
process.env.SABER_PLUGIN_CONFIG = ''

const { apply } = await import('../lib/index.js')
const tools = new Map()
apply({
  tools: {
    register(tool) {
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
  },
  effect(fn) { return fn() },
})

function textOf(result) {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result.map(block => block?.text ?? '').join('\n')
  return JSON.stringify(result)
}

async function call(name, args = {}) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`missing tool ${name}`)
  const value = await tool.execute(args)
  return textOf(tool.output.render(args, value))
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

try {
  const status = await call('saber_status')
  assert(status.includes('3.5+') || status.includes('/api/v2'), 'status detects v2 flavor')
  assert(status.includes('Worker：在线'), 'status reports worker online')

  assert((await call('saber_books')).includes('夜缚'), 'books lists the mock book')
  assert((await call('saber_book', { bookId: 'b1' })).includes('c1'), 'book lists chapters')
  const pages = await call('saber_pages', { chapterId: 'c1' })
  assert(pages.includes('p1') && pages.includes('已出图'), 'pages lists page + render status')

  const start = await call('saber_translate', { chapterId: 'c1', mode: 'hq' })
  assert(start.includes('j1'), 'translate returns job id')
  const createRequest = state.requests.find(item => item.path === '/api/v2/chapters/c1/translation-jobs')
  assert(createRequest !== undefined, 'translate called the job endpoint')
  const createBody = JSON.parse(createRequest.body)
  assert(createBody.config.mode === 'hq', 'translate sent mode=hq')
  assert(createBody.config.executionMode === 'sequential', 'translate sent executionMode')
  assert(typeof createRequest.headers['idempotency-key'] === 'string', 'translate sent Idempotency-Key')

  assert((await call('saber_jobs', { scope: 'queue' })).includes('j1'), 'jobs lists j1')
  const detail = await call('saber_job', { jobId: 'j1' })
  assert(detail.includes('已完成') || detail.includes('完成'), 'job detail renders counts')

  assert((await call('saber_job_control', { jobId: 'j1', action: 'pause' })).includes('pause'), 'job_control pauses')
  assert(state.requests.some(item => item.path === '/api/v2/jobs/j1/pause'), 'job_control called pause endpoint')

  const image = await call('saber_page_image', { pageId: 'p1', kind: 'translated' })
  const file = image.match(/本地文件：(.+)/)?.[1]?.trim()
  assert(file !== undefined && existsSync(file), 'page_image saved a real file')

  const terms = await call('saber_terms', { bookId: 'b1' })
  assert(terms.includes('revision=3') && terms.includes('术语表'), 'terms reads glossary document')

  console.log('\nmock-v2: PASS')
} finally {
  server.close()
}
