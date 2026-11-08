/**
 * Shared tool plumbing: schema normalization, text tools, formatting.
 *
 * JSON Schema note: the OpenAI-compatible function-calling API requires
 * `required` to be a STRING ARRAY on the object node. A boolean `required`
 * inside a property makes the provider reject the whole request
 * ("true is not of type \"array\""), so `normalizeParameters` hoists it.
 *
 * @module dsh-plugin-saber/tools/shared
 */

/** Recursively hoist per-property `required: true` into the object's array. */
export function normalizeParameters(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const result = { ...node }

  if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
    const properties = {}
    const hoisted = []
    for (const [key, raw] of Object.entries(result.properties)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        properties[key] = raw
        continue
      }
      const { required, ...rest } = raw
      if (required === true) hoisted.push(key)
      properties[key] = normalizeParameters(rest)
    }
    result.properties = properties
    const existing = Array.isArray(result.required)
      ? result.required.filter(value => typeof value === 'string')
      : []
    const merged = [...new Set([...existing, ...hoisted])]
    if (merged.length > 0) result.required = merged
    else delete result.required
  } else if ('required' in result && !Array.isArray(result.required)) {
    delete result.required
  }

  if (result.items !== undefined) result.items = normalizeParameters(result.items)
  return result
}

/** Fail fast at registration instead of failing the model request later. */
export function assertToolParameters(toolName, parameters) {
  if (!parameters || parameters.type !== 'object') {
    throw new Error(`${toolName}: parameters must be an object schema`)
  }
  if (!parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
    throw new Error(`${toolName}: parameters.properties must be an object`)
  }
  if (parameters.required !== undefined && !Array.isArray(parameters.required)) {
    throw new Error(`${toolName}: parameters.required must be a string array`)
  }
  for (const [key, value] of Object.entries(parameters.properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${toolName}: property ${key} must be a schema object`)
    }
    if (value.required === true) {
      throw new Error(`${toolName}: property ${key} still carries required:true after normalization`)
    }
  }
}

/** A registry-ready text tool (raw definition, no SDK import). */
export function defineTextTool({ name, description, parameters, run }) {
  const normalized = normalizeParameters(parameters)
  assertToolParameters(name, normalized)
  return {
    name,
    description,
    parameters: normalized,
    output: {
      schema: {},
      render(_args, value) {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      return run(args ?? {})
    },
  }
}

/** Register every tool and return disposers. */
export function registerTools(ctx, tools) {
  return tools.map(tool => ctx.tools.register(tool))
}

/** Format an ISO timestamp (or epoch ms) for the model. */
export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '未知'
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

/** Render a page render status in Chinese. */
export function renderStatusLabel(status) {
  switch (status) {
    case 'ready': return '已出图'
    case 'stale': return '待重渲'
    case 'rendering': return '渲染中'
    case 'render_failed': return '渲染失败'
    case 'awaiting_repair': return '待修复'
    case 'repair_failed': return '修复失败'
    case 'not_rendered': return '未渲染'
    default: return String(status ?? '未知')
  }
}

/** Render a job status in Chinese. */
export function jobStatusLabel(status) {
  switch (status) {
    case 'queued': return '排队'
    case 'running': return '执行中'
    case 'paused': return '已暂停'
    case 'cancelled': return '已取消'
    case 'completed': return '已完成'
    case 'completed_with_errors': return '完成但有错误'
    case 'failed': return '失败'
    case 'interrupted': return '中断'
    default: return String(status ?? '未知')
  }
}

/** Shorten long text for one-line summaries. */
export function clip(text, max = 60) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
