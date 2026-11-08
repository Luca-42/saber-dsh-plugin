/**
 * Backend lifecycle + glossary tools.
 *
 * @module dsh-plugin-saber/tools/backend
 */

import { defineTextTool } from './shared.js'

function summarizeConstraints(doc) {
  const payload = doc?.payload ?? {}
  const glossary = payload.glossary ?? {}
  const nonTranslate = payload.nonTranslate ?? {}
  const entries = Array.isArray(glossary.entries) ? glossary.entries : []
  const forbidden = Array.isArray(nonTranslate.entries) ? nonTranslate.entries : []
  const lines = [
    `版本 revision=${doc?.revision ?? '?'}`,
    `术语表：${glossary.enabled ? '启用' : '关闭'} · ${entries.length} 条（自动抽取 ${glossary.autoExtractEnabled ? '开' : '关'}）`,
  ]
  for (const entry of entries.slice(0, 20)) lines.push(`  - ${JSON.stringify(entry)}`)
  if (entries.length > 20) lines.push(`  …还有 ${entries.length - 20} 条`)
  lines.push(`禁翻表：${nonTranslate.enabled ? '启用' : '关闭'} · ${forbidden.length} 条`)
  for (const entry of forbidden.slice(0, 20)) lines.push(`  - ${JSON.stringify(entry)}`)
  if (forbidden.length > 20) lines.push(`  …还有 ${forbidden.length - 20} 条`)
  return lines.join('\n')
}

export function backendTools(deps) {
  const { getAdapter, supervisor } = deps

  return [
    defineTextTool({
      name: 'saber_backend',
      description:
        '管理 Saber 后端进程：status 查看是否在跑、由谁启动、可执行文件路径；'
        + 'start 在未运行时用配置的安装路径启动；stop 只停止本插件启动的进程。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'start', 'stop'], description: '默认 status' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const action = typeof args.action === 'string' ? args.action : 'status'
        if (action === 'status') {
          const state = await supervisor.status()
          return [
            `后端：${state.running ? `运行中（${state.flavor === 'v2' ? '3.5+ /api/v2' : '3.3.x legacy'}）` : '未运行'}`,
            `由插件启动：${state.startedByUs ? `是（PID ${state.pid}）` : '否'}`,
            `可执行文件：${state.exe ?? '未配置/未找到'}`,
          ].join('\n')
        }
        if (action === 'start') {
          const result = await supervisor.ensureRunning()
          if (result.error) return `启动未完成：${result.error}`
          return result.started
            ? `已启动 Saber（PID ${result.pid ?? '?'}），API 就绪：${result.flavor === 'v2' ? '/api/v2' : 'legacy'}`
            : `Saber 已在运行（${result.flavor === 'v2' ? '3.5+' : 'legacy'}），未重复启动。`
        }
        const result = await supervisor.stop()
        return result.stopped ? `已停止插件启动的 Saber（PID ${result.pid}）。` : `未停止：${result.reason}`
      },
    }),

    defineTextTool({
      name: 'saber_terms',
      description:
        '读写一本书的术语表与禁翻表（3.5+）。action=get 读取当前内容与 revision；'
        + 'action=set 写入完整 payload（需要 glossary 与 nonTranslate 两个对象，结构与 get 返回一致）。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书籍 ID' },
          action: { type: 'string', enum: ['get', 'set'], description: '默认 get' },
          payload: {
            type: 'object',
            additionalProperties: true,
            description: 'set 时要写入的完整 payload（{glossary, nonTranslate}）',
          },
          baseRevision: {
            type: 'integer',
            minimum: 1,
            description: 'set 时的乐观版本；留空则自动取当前 revision',
          },
        },
        required: ['bookId'],
        additionalProperties: false,
      },
      async run(args) {
        const bookId = String(args.bookId ?? '').trim()
        if (bookId.length === 0) throw new Error('bookId 不能为空。')
        const adapter = await getAdapter()
        if (!adapter) throw new Error('Saber 未运行：先用 saber_backend action=status 排查。')
        if (adapter.flavor !== 'v2') throw new Error('saber_terms 需要 Saber 3.5+（/api/v2）。')

        const action = typeof args.action === 'string' ? args.action : 'get'
        if (action === 'get') {
          const doc = await adapter.getConstraints(bookId)
          return [`书籍 ${bookId} 翻译约束：`, summarizeConstraints(doc)].join('\n')
        }

        if (!args.payload || typeof args.payload !== 'object') {
          throw new Error('set 需要 payload：先 action=get 拿到结构，再整体写回。')
        }
        const current = await adapter.getConstraints(bookId)
        const baseRevision = Number.isInteger(args.baseRevision) ? args.baseRevision : current?.revision
        if (!Number.isInteger(baseRevision)) throw new Error('拿不到当前 revision，请先 action=get。')
        const updated = await adapter.putConstraints(bookId, { baseRevision, payload: args.payload })
        return [`书籍 ${bookId} 翻译约束已更新（revision ${updated?.revision ?? '?'}）。`, summarizeConstraints(updated)].join('\n')
      },
    }),
  ]
}
