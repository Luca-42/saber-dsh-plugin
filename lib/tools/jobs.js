/**
 * Job tools for the v2 API: start translation, inspect jobs, control them.
 *
 * Each tool is a small factory; the `run` bodies live in named helpers so no
 * single function grows past the readability budget.
 *
 * @module dsh-plugin-saber/tools/jobs
 */

import { defineTextTool, formatTime, jobStatusLabel } from './shared.js'

function requireV2(adapter, toolName) {
  if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
  if (adapter.flavor !== 'v2') {
    throw new Error(
      `${toolName} 需要 Saber 3.5+（/api/v2 任务队列）。当前后端是 ${adapter.versionLabel}，`
      + '老版本没有任务 API；升级到 3.5+ 后可用。',
    )
  }
  return adapter
}

function progressLine(job) {
  const progress = job?.progress ?? {}
  const total = progress.totalItems ?? 0
  const done = progress.completedItems ?? 0
  const failed = progress.failedItems ?? 0
  return `${done}/${total}${failed > 0 ? `（失败 ${failed}）` : ''}`
}

/**
 * @param {{ getAdapter: Function }} deps
 */
export function jobTools(deps) {
  return [translateTool(deps), jobsTool(deps), jobTool(deps), controlTool(deps)]
}

// ------------------------------------------------------------- saber_translate

function translateTool(deps) {
  return defineTextTool({
    name: 'saber_translate',
    description:
      '给 Saber 排翻译任务（写操作，直接执行不弹确认）。可以指定单章、多章或整本书；'
      + '返回 jobIds 后，用 saber_job 看进度、saber_job_control 暂停/取消。'
      + '模式：standard 常规 / hq 高质量 / proofread AI 校对 / remove_text 仅消字。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '只翻这一章（与 chapterIds/bookIds 二选一）' },
        chapterIds: { type: 'array', items: { type: 'string' }, description: '多章批量（与 bookIds 二选一）' },
        bookIds: { type: 'array', items: { type: 'string' }, description: '整本书批量（与 chapterIds 二选一）' },
        mode: {
          type: 'string',
          enum: ['standard', 'hq', 'proofread', 'remove_text'],
          description: '翻译模式，默认 standard',
        },
        executionMode: {
          type: 'string',
          enum: ['sequential', 'parallel'],
          description: '执行方式，默认 sequential',
        },
        pageIds: {
          type: 'array',
          items: { type: 'string' },
          description: '只处理指定页面（可选，仅单章任务支持）',
        },
        skipCompleted: { type: 'boolean', description: '跳过已完成页面（可选）' },
      },
      additionalProperties: false,
    },
    run: args => runTranslate(deps, args),
  })
}

async function runTranslate(deps, args) {
  const adapter = requireV2(await deps.getAdapter(), 'saber_translate')
  const chapterIds = Array.isArray(args.chapterIds) ? args.chapterIds : []
  const bookIds = Array.isArray(args.bookIds) ? args.bookIds : []
  if (chapterIds.length > 0 || bookIds.length > 0) {
    if (chapterIds.length > 0 && bookIds.length > 0) throw new Error('chapterIds 与 bookIds 只能二选一。')
    return runBatchTranslate(adapter, args, { chapterIds, bookIds })
  }
  const chapterId = typeof args.chapterId === 'string' ? args.chapterId.trim() : ''
  if (chapterId.length === 0) throw new Error('需要 chapterId，或者提供 chapterIds/bookIds 做批量。')
  return runChapterTranslate(adapter, args, chapterId)
}

async function runBatchTranslate(adapter, args, { chapterIds, bookIds }) {
  const mode = typeof args.mode === 'string' ? args.mode : 'standard'
  const executionMode = typeof args.executionMode === 'string' ? args.executionMode : 'sequential'
  const accepted = await adapter.startBatchTranslation({ chapterIds, bookIds, mode, executionMode })
  const skipped = Array.isArray(accepted?.skipped) ? accepted.skipped : []
  const lines = [
    `已排批量翻译：batch ${accepted?.batchId ?? '?'} · ${mode}/${executionMode}`,
    `任务：${(accepted?.jobIds ?? []).join(', ') || '（无）'}`,
  ]
  for (const item of skipped) lines.push(`跳过章节 ${item.chapterId}: ${item.reason}（${item.message}）`)
  lines.push('接下来：saber_jobs 看队列，saber_job jobId=<id> 看进度。')
  return lines.join('\n')
}

async function runChapterTranslate(adapter, args, chapterId) {
  const mode = typeof args.mode === 'string' ? args.mode : 'standard'
  const executionMode = typeof args.executionMode === 'string' ? args.executionMode : 'sequential'
  const accepted = await adapter.startChapterTranslation({
    chapterId,
    mode,
    executionMode,
    pageIds: Array.isArray(args.pageIds) ? args.pageIds : undefined,
    skipCompleted: args.skipCompleted === true,
  })
  return [
    `已排翻译：章节 ${chapterId} · ${mode}/${executionMode}`,
    `任务：${(accepted?.jobIds ?? []).join(', ') || '（无）'}`,
    '接下来：saber_jobs 看队列，saber_job jobId=<id> 看进度。',
  ].join('\n')
}

// ----------------------------------------------------------------- saber_jobs

function jobsTool(deps) {
  return defineTextTool({
    name: 'saber_jobs',
    description:
      '列出 Saber 任务（只读）。scope=queue 看当前队列，history 看已完成/失败历史，all 两者都要。'
      + '返回 jobId、类型、状态、进度与队列是否暂停。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['queue', 'history', 'all'], description: '默认 queue' },
        status: {
          type: 'string',
          enum: ['queued', 'running', 'paused', 'cancelled', 'completed', 'completed_with_errors', 'failed', 'interrupted'],
          description: '只看某个状态（可选）',
        },
        bookId: { type: 'string', description: '只看某本书的任务（可选）' },
        limit: { type: 'integer', description: '历史条数上限（默认 30，最大 200）', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: args => runJobs(deps, args),
  })
}

async function runJobs(deps, args) {
  const adapter = requireV2(await deps.getAdapter(), 'saber_jobs')
  const data = await adapter.listJobs({
    scope: typeof args.scope === 'string' ? args.scope : 'queue',
    status: typeof args.status === 'string' ? args.status : undefined,
    bookId: typeof args.bookId === 'string' ? args.bookId : undefined,
    limit: Number.isInteger(args.limit) ? args.limit : 30,
  })
  const items = Array.isArray(data?.items) ? data.items : []
  const lines = [
    `Worker ${data?.workerOnline ? '在线' : '离线'} · 队列${data?.queuePaused ? '已暂停' : '运行中'}`
    + ` · 执行器${data?.executorBusy ? '忙' : '空闲'}`,
  ]
  if (items.length === 0) {
    lines.push('没有符合条件的任务。')
    return lines.join('\n')
  }
  lines.push(`任务 ${items.length} 条：`)
  for (const job of items) lines.push(jobLine(job))
  return lines.join('\n')
}

function jobLine(job) {
  return `- ${job.jobId} [${jobStatusLabel(job.status)}] ${job.kind ?? '?'}`
    + ` · 进度 ${progressLine(job)}`
    + `${job.queueRank ? ` · 队列第 ${job.queueRank} 位` : ''}`
    + `${job.chapterId ? ` · 章节 ${job.chapterId}` : ''}`
    + ` · ${formatTime(job.createdAt)}`
}

// ------------------------------------------------------------------ saber_job

function jobTool(deps) {
  return defineTextTool({
    name: 'saber_job',
    description:
      '查看单个 Saber 任务的详情（只读）：总进度、各状态计数、失败条目与错误、产物列表。',
    parameters: {
      type: 'object',
      properties: { jobId: { type: 'string', description: '任务 ID（来自 saber_translate / saber_jobs）' } },
      required: ['jobId'],
      additionalProperties: false,
    },
    run: args => runJob(deps, args),
  })
}

async function runJob(deps, args) {
  const jobId = String(args.jobId ?? '').trim()
  if (jobId.length === 0) throw new Error('jobId 不能为空。')
  const adapter = requireV2(await deps.getAdapter(), 'saber_job')
  const detail = await adapter.getJob(jobId)
  const counts = detail?.counts ?? {}
  const lines = [
    `任务 ${jobId} · ${detail?.kind ?? '?'} · ${jobStatusLabel(detail?.status)}`,
    `进度：${progressLine(detail)}`
    + ` · 完成 ${counts.completed ?? 0} / 失败 ${counts.failed ?? 0} / 跳过 ${counts.skipped ?? 0}`
    + ` / 取消 ${counts.cancelled ?? 0} / 共 ${counts.total ?? 0}`,
    `时间：创建 ${formatTime(detail?.createdAt)} · 开始 ${formatTime(detail?.startedAt)} · 结束 ${formatTime(detail?.finishedAt)}`,
  ]
  if (detail?.error) lines.push(`错误：${typeof detail.error === 'string' ? detail.error : JSON.stringify(detail.error)}`)
  lines.push(...failureLines(detail?.failedItems))
  lines.push(...artifactLines(detail?.artifacts))
  return lines.join('\n')
}

function failureLines(failedItems) {
  const failed = Array.isArray(failedItems) ? failedItems : []
  if (failed.length === 0) return []
  const lines = [`失败条目 ${failed.length}：`]
  for (const item of failed.slice(0, 10)) {
    const reason = item?.error?.message ?? JSON.stringify(item?.error ?? {})
    lines.push(`- 第${item.ordinal ?? '?'}项 ${item.pageId ?? ''} · ${item.stepKind ?? ''} · ${reason}`)
  }
  if (failed.length > 10) lines.push(`…还有 ${failed.length - 10} 条`)
  return lines
}

function artifactLines(artifacts) {
  const list = Array.isArray(artifacts) ? artifacts : []
  if (list.length === 0) return []
  const lines = [`产物 ${list.length} 个：`]
  for (const artifact of list.slice(0, 10)) {
    lines.push(`- ${artifact.kind ?? '?'} ${artifact.url ?? artifact.assetId ?? JSON.stringify(artifact)}`)
  }
  return lines
}

// ----------------------------------------------------------- saber_job_control

function controlTool(deps) {
  return defineTextTool({
    name: 'saber_job_control',
    description:
      '控制 Saber 任务（写操作，直接执行不弹确认）：暂停、恢复、取消、重试失败项、继续。'
      + '也可以暂停/恢复整个队列（jobId 留空，action=queue-pause / queue-resume）。',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID（队列操作时留空）' },
        action: {
          type: 'string',
          enum: ['pause', 'resume', 'cancel', 'retry', 'retry-failed', 'continue', 'queue-pause', 'queue-resume'],
          description: '要执行的操作',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: args => runControl(deps, args),
  })
}

async function runControl(deps, args) {
  const adapter = requireV2(await deps.getAdapter(), 'saber_job_control')
  const action = String(args.action ?? '')
  if (action === 'queue-pause' || action === 'queue-resume') {
    await adapter.queueAction(action === 'queue-pause' ? 'pause' : 'resume')
    return action === 'queue-pause' ? '已暂停整个任务队列。' : '已恢复整个任务队列。'
  }
  const jobId = String(args.jobId ?? '').trim()
  if (jobId.length === 0) throw new Error(`action=${action} 需要 jobId。`)
  await adapter.jobAction(jobId, action)
  return `任务 ${jobId} 已执行 ${action}。用 saber_job 查看最新状态。`
}
