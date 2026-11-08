/**
 * Read-only content tools: backend status, shelf, one book, chapter pages.
 *
 * Every tool is a small factory; the `run` bodies live in named helpers so no
 * single function grows past the readability budget.
 *
 * @module dsh-plugin-saber/tools/content
 */

import { defineTextTool, formatTime, renderStatusLabel } from './shared.js'

function bookItems(data) {
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.books)) return data.books
  return []
}

function chaptersOf(detail) {
  if (Array.isArray(detail?.chapters)) return detail.chapters
  if (Array.isArray(detail?.book?.chapters)) return detail.book.chapters
  return []
}

const EMPTY_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

/**
 * @param {{ getAdapter: Function }} deps
 */
export function contentTools(deps) {
  return [statusTool(deps), booksTool(deps), bookTool(deps), pagesTool(deps)]
}

// --------------------------------------------------------------- saber_status

function statusTool(deps) {
  return defineTextTool({
    name: 'saber_status',
    description:
      '检查本机 Saber-Translator 后端状态：API 版本线（3.5+ /api/v2 或 3.3.x legacy）、'
      + '存储版本、端口、书架规模、Worker 是否在线、任务队列是否暂停。'
      + '任何 Saber 操作前先调用它确认连接与版本。',
    parameters: EMPTY_PARAMS,
    run: () => runStatus(deps),
  })
}

async function runStatus(deps) {
  const adapter = await deps.getAdapter()
  if (!adapter) return offlineText()
  const lines = [`Saber 状态：在线（${adapter.versionLabel}）`]
  lines.push(...await connectionLines(adapter))
  lines.push(...await shelfLines(adapter))
  lines.push(...await queueLines(adapter))
  return lines.join('\n')
}

function offlineText() {
  return [
    'Saber 状态：离线',
    '没有找到 /api/v2/health 或 /api/server-info 响应。',
    '排查：确认 Saber 已启动；若端口不是 5000，改配置 baseUrl；需要插件代启就把 installPath 配好。',
  ].join('\n')
}

async function connectionLines(adapter) {
  const lines = []
  try {
    const info = await adapter.serverInfo()
    if (info?.port !== undefined) lines.push(`端口：${info.port}`)
    if (info?.lanUrl) lines.push(`局域网：${info.lanUrl}`)
  } catch {
    lines.push('服务信息：读取失败')
  }
  if (adapter.flavor === 'v2') {
    try {
      const health = await adapter.health()
      if (health?.storageVersion) lines.push(`存储版本：${health.storageVersion}`)
      if (health?.status) lines.push(`API 健康：${health.status === 'ok' ? '正常' : 'fenced（失去租约）'}`)
    } catch {
      lines.push('健康检查：失败')
    }
  }
  return lines
}

async function shelfLines(adapter) {
  try {
    const items = bookItems(await adapter.listBooks())
    return [`书架：${items.length} 本书`]
  } catch {
    return ['书架：读取失败']
  }
}

async function queueLines(adapter) {
  if (adapter.flavor !== 'v2') {
    return ['任务队列：该版本没有任务 API（3.3.x 翻译走会话/单次请求）']
  }
  try {
    const jobs = await adapter.listJobs({ scope: 'queue', limit: 50 })
    const lines = [
      `Worker：${jobs?.workerOnline ? '在线' : '离线'}`,
      `队列：${jobs?.queuePaused ? '已暂停' : '运行中'} · 当前任务 ${Array.isArray(jobs?.items) ? jobs.items.length : 0} 条`,
    ]
    if (jobs?.waitingReason) lines.push(`等待原因：${JSON.stringify(jobs.waitingReason)}`)
    return lines
  } catch {
    return ['任务队列：读取失败（Worker 可能未启动）']
  }
}

// ---------------------------------------------------------------- saber_books

function booksTool(deps) {
  return defineTextTool({
    name: 'saber_books',
    description:
      '列出 Saber 书架上的漫画（只读）。返回每本书的 bookId、标题、章节数、页数、'
      + '最近更新时间与任务状态；bookId 可直接传给 saber_book / saber_translate。',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '按书名过滤（可选）' },
        limit: { type: 'integer', description: '最多返回多少本（默认 50）', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: args => runBooks(deps, args),
  })
}

async function runBooks(deps, args) {
  const adapter = await deps.getAdapter()
  if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
  const data = await adapter.listBooks({ search: typeof args.search === 'string' ? args.search : undefined })
  const items = bookItems(data)
  if (items.length === 0) {
    return typeof args.search === 'string' && args.search.length > 0
      ? `书架里没有匹配「${args.search}」的书。`
      : '书架是空的：先在 Saber 里创建书籍并导入章节。'
  }
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50
  const shown = items.slice(0, limit)
  const lines = [`共 ${items.length} 本书（显示 ${shown.length} 本）：`]
  shown.forEach((book, index) => lines.push(bookLine(book, index)))
  if (items.length > shown.length) lines.push(`…还有 ${items.length - shown.length} 本，用 search 或 limit 缩小范围。`)
  return lines.join('\n')
}

function bookLine(book, index) {
  const chapters = book.chapterCount ?? book.chapter_count ?? '?'
  const pages = book.pageCount ?? (Number.isFinite(book.total_pages) ? book.total_pages : undefined)
  const tags = Array.isArray(book.tags) && book.tags.length > 0
    ? ` · 标签 ${book.tags.map(tag => (typeof tag === 'string' ? tag : tag.name)).join(',')}`
    : ''
  const status = book.jobStatusSummary ? ` · 任务 ${summaryText(book.jobStatusSummary)}` : ''
  return `${index + 1}. ${book.id} 「${book.title}」 · 章节 ${chapters}`
    + `${pages === undefined ? '' : ` · 页数 ${pages}`}`
    + ` · 更新 ${formatTime(book.updatedAt ?? book.updated_at)}${tags}${status}`
}

function summaryText(summary) {
  const parts = Object.entries(summary).filter(([, count]) => count > 0).map(([key, count]) => `${key}:${count}`)
  return parts.length > 0 ? parts.join(',') : '无'
}

// ----------------------------------------------------------------- saber_book

function bookTool(deps) {
  return defineTextTool({
    name: 'saber_book',
    description:
      '读取一本书的详情与章节列表（只读）。返回 bookId、标题、章节 chapterId、序号、页数'
      + '以及每章的任务状态；chapterId 可直接传给 saber_pages / saber_translate。',
    parameters: {
      type: 'object',
      properties: { bookId: { type: 'string', description: '书籍 ID（来自 saber_books）' } },
      required: ['bookId'],
      additionalProperties: false,
    },
    run: args => runBook(deps, args),
  })
}

async function runBook(deps, args) {
  const bookId = String(args.bookId ?? '').trim()
  if (bookId.length === 0) throw new Error('bookId 不能为空：先用 saber_books 找书。')
  const adapter = await deps.getAdapter()
  if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
  const detail = await adapter.getBook(bookId)
  const chapters = chaptersOf(detail)
  const book = detail?.book ?? detail
  const lines = [
    `书籍 ${book.id ?? bookId} 「${book.title ?? '（无标题）'}」`,
    `章节 ${chapters.length}`
    + `${book.pageCount !== undefined ? ` · 总页数 ${book.pageCount}` : ''}`
    + `${book.total_pages !== undefined ? ` · 总页数 ${book.total_pages}` : ''}`
    + ` · 更新 ${formatTime(book.updatedAt ?? book.updated_at)}`,
  ]
  if (chapters.length === 0) {
    lines.push('（这本书还没有章节：先在 Saber 里导入图片，或新建章节。）')
    return lines.join('\n')
  }
  lines.push('章节：')
  for (const chapter of chapters) {
    const pages = chapter.pageCount ?? chapter.page_count ?? 0
    const status = chapter.jobStatusSummary ? ` · 任务 ${summaryText(chapter.jobStatusSummary)}` : ''
    lines.push(`- ${chapter.id} 第${chapter.ordinal ?? '?'}章 「${chapter.title}」 · ${pages} 页${status}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- saber_pages

function pagesTool(deps) {
  return defineTextTool({
    name: 'saber_pages',
    description:
      '列出某一章的页面（只读）。返回每页 pageId、序号、渲染状态、尺寸、是否有译图。'
      + '3.3.x 老版本需要同时给 bookId；3.5+ 只需要 chapterId。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节 ID（来自 saber_book）' },
        bookId: { type: 'string', description: '书籍 ID（3.3.x 老版本需要）' },
        limit: { type: 'integer', description: '最多返回多少页（默认 50，最大 200）', minimum: 1, maximum: 200 },
        all: { type: 'boolean', description: '一次取全部页面（3.5+ 支持）' },
      },
      required: ['chapterId'],
      additionalProperties: false,
    },
    run: args => runPages(deps, args),
  })
}

async function runPages(deps, args) {
  const chapterId = String(args.chapterId ?? '').trim()
  if (chapterId.length === 0) throw new Error('chapterId 不能为空。')
  const adapter = await deps.getAdapter()
  if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
  if (adapter.flavor === 'v2') return v2Pages(adapter, chapterId, args)
  return legacyPages(adapter, chapterId, args)
}

async function v2Pages(adapter, chapterId, args) {
  const limit = Number.isInteger(args.limit) ? args.limit : 50
  const data = await adapter.listPages(chapterId, { limit, all: args.all === true })
  const items = Array.isArray(data?.items) ? data.items : []
  if (items.length === 0) return `章节 ${chapterId} 还没有页面：先在 Saber 里导入图片。`
  const lines = [`章节 ${chapterId}：${items.length} 页${data?.nextCursor ? '（还有更多，用 limit 或 all 翻页）' : ''}`]
  for (const page of items) {
    lines.push(
      `- 第${page.ordinal}页 ${page.id} · ${renderStatusLabel(page.renderStatus)}`
      + ` · ${page.width ?? '?'}x${page.height ?? '?'}`
      + ` · 检测 ${page.detectionState === 'processed' ? '完成' : '未处理'}`
      + ` · 译图 ${page.translatedUrl ? '有' : '无'}`,
    )
  }
  return lines.join('\n')
}

async function legacyPages(adapter, chapterId, args) {
  const bookId = String(args.bookId ?? '').trim()
  if (bookId.length === 0) throw new Error('3.3.x 老版本需要同时提供 bookId。')
  const data = await adapter.listChapterImages(bookId, chapterId)
  const images = Array.isArray(data?.images) ? data.images : []
  if (images.length === 0) return `章节 ${chapterId} 还没有图片。`
  const limit = Number.isInteger(args.limit) ? args.limit : 50
  const lines = [`章节 ${chapterId}：${images.length} 张图`]
  images.slice(0, limit).forEach((image, index) => {
    lines.push(`- ${index + 1}. ${typeof image === 'string' ? image : JSON.stringify(image)}`)
  })
  return lines.join('\n')
}
