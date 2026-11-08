/**
 * Adapter for Saber 3.5+ backend-first API (`/api/v2`).
 *
 * Contract source: openapi/v2.yaml at the installed release.
 *
 * @module dsh-plugin-saber/adapters/v2
 */

import { randomUUID } from 'node:crypto'

const P = '/api/v2'

function enc(value) {
  return encodeURIComponent(String(value))
}

function query(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (entries.length === 0) return ''
  return `?${entries.map(([key, value]) => `${enc(key)}=${enc(value)}`).join('&')}`
}

/** @param {import('../saber-client.js').createSaberClient extends (...a:any)=>infer R ? R : any} client */
export function createV2Adapter(client) {
  return {
    flavor: 'v2',
    versionLabel: 'Saber 3.5+（/api/v2）',

    health: () => client.request(`${P}/health`, { timeoutMs: 5000 }),
    serverInfo: () => client.request(`${P}/system/server-info`),
    capabilities: () => client.request(`${P}/system/capabilities`),

    /** @returns {Promise<{items: any[]}>} */
    listBooks: ({ search } = {}) => client.request(`${P}/books${query({ search })}`),
    getBook: bookId => client.request(`${P}/books/${enc(bookId)}`),
    /** @returns {Promise<{book: any, chapters: any[]}>} */
    listChapters: bookId => client.request(`${P}/books/${enc(bookId)}/chapters`),
    /** @returns {Promise<{items: any[], nextCursor: number|null}>} */
    listPages: (chapterId, { limit, cursor, all } = {}) => client.request(
      `${P}/chapters/${enc(chapterId)}/pages${query({ limit, cursor, all: all === true ? 1 : undefined })}`,
    ),
    getPage: pageId => client.request(`${P}/pages/${enc(pageId)}`),

    /**
     * Queue a translation job for one chapter.
     * @param {{chapterId: string, mode?: 'standard'|'hq'|'proofread'|'remove_text', executionMode?: 'sequential'|'parallel', pageIds?: string[], skipCompleted?: boolean}} command
     */
    async startChapterTranslation({ chapterId, mode = 'standard', executionMode = 'sequential', pageIds, skipCompleted }) {
      const config = { mode, executionMode }
      if (skipCompleted === true) config.skipCompleted = true
      const body = { config }
      if (Array.isArray(pageIds) && pageIds.length > 0) body.pageIds = pageIds
      return client.request(`${P}/chapters/${enc(chapterId)}/translation-jobs`, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': randomUUID() },
      })
    },

    /**
     * Queue translation for whole books or several chapters.
     * @param {{bookIds?: string[], chapterIds?: string[], mode?: string, executionMode?: string}} command
     */
    async startBatchTranslation({ bookIds, chapterIds, mode = 'standard', executionMode = 'sequential' }) {
      const body = { config: { mode, executionMode } }
      if (Array.isArray(chapterIds) && chapterIds.length > 0) body.chapterIds = chapterIds
      if (Array.isArray(bookIds) && bookIds.length > 0) body.bookIds = bookIds
      return client.request(`${P}/translation-batches`, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': randomUUID() },
      })
    },

    /** @returns {Promise<{items: any[], queuePaused: boolean, workerOnline: boolean, executorBusy: boolean, waitingReason: any}>} */
    listJobs: ({ scope = 'queue', status, type, bookId, limit } = {}) => client.request(
      `${P}/jobs${query({ scope, status, type, book_id: bookId, limit })}`,
    ),
    getJob: jobId => client.request(`${P}/jobs/${enc(jobId)}`),
    jobEvents: (jobId, { after, limit } = {}) => client.request(
      `${P}/jobs/${enc(jobId)}/events${query({ after, limit })}`,
    ),

    /** pause | resume | cancel | retry | retry-failed | continue */
    async jobAction(jobId, action) {
      const allowed = new Set(['pause', 'resume', 'cancel', 'retry', 'retry-failed', 'continue'])
      if (!allowed.has(action)) throw new Error(`不支持的任务操作：${action}`)
      return client.request(`${P}/jobs/${enc(jobId)}/${action}`, { method: 'POST' })
    },

    /** Queue-wide controls. */
    async queueAction(action) {
      if (action === 'pause') return client.request(`${P}/jobs/queue/pause`, { method: 'POST' })
      if (action === 'resume') return client.request(`${P}/jobs/queue/resume`, { method: 'POST' })
      throw new Error(`不支持的队列操作：${action}`)
    },

    getConstraints: bookId => client.request(`${P}/books/${enc(bookId)}/translation-constraints`),
    putConstraints: (bookId, { baseRevision, payload }) => client.request(
      `${P}/books/${enc(bookId)}/translation-constraints`,
      { method: 'PUT', body: { baseRevision, payload } },
    ),

    fetchImage: url => client.requestBuffer(url),
  }
}
