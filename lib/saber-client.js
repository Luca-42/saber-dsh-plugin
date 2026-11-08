/**
 * Minimal HTTP client for a locally running Saber-Translator backend.
 *
 * Two API generations are supported by adapters:
 * - v2 (Saber 3.5+): `/api/v2/*` with durable jobs and SSE
 * - legacy (Saber 3.3.x): `/api/bookshelf/*`, `/api/server-info`
 *
 * No runtime dependency on @deepseek-ai/*: this half runs inside the DSH host
 * process and must stay dependency-free.
 *
 * @module dsh-plugin-saber/saber-client
 */

export const DEFAULT_BASE_URL = 'http://127.0.0.1:5000'
const DEFAULT_TIMEOUT_MS = 15000

/** A safe, model-facing error. */
export class SaberError extends Error {
  constructor(message, { code = 'SABER_ERROR', status, path } = {}) {
    super(message)
    this.name = 'SaberError'
    this.code = code
    this.status = status
    this.path = path
  }
}

/** Normalize a base URL: strip trailing slashes, reject non-http(s). */
export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim()
  const url = raw.length > 0 ? raw : DEFAULT_BASE_URL
  if (!/^https?:\/\//i.test(url)) {
    throw new SaberError(`Saber 地址必须以 http:// 或 https:// 开头：${url}`, { code: 'SABER_BAD_URL' })
  }
  return url.replace(/\/+$/, '')
}

/**
 * @param {{ baseUrl?: string, timeoutMs?: number }} [options]
 */
export function createSaberClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const defaultTimeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS

  /** Build an absolute URL for a possibly-relative Saber URL. */
  function absolute(url) {
    const value = String(url ?? '')
    if (/^https?:\/\//i.test(value)) return value
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`
  }

  async function send(url, { method, body, headers, signal, timeoutMs } = {}) {
    const target = absolute(url)
    try {
      return await fetch(target, {
        method: method ?? 'GET',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(headers ?? {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(timeoutMs ?? defaultTimeout),
      })
    } catch (error) {
      const reason = error?.name === 'TimeoutError'
        ? `超时（${timeoutMs ?? defaultTimeout}ms）`
        : (error?.message ?? String(error))
      throw new SaberError(`无法连接 Saber（${baseUrl}）：${reason}`, {
        code: 'SABER_UNREACHABLE',
        path: target,
      })
    }
  }

  /**
   * JSON request. Throws SaberError with status + server message on failure.
   * @returns {Promise<any>}
   */
  async function request(path, options = {}) {
    const response = await send(path, options)
    const text = await response.text()
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()

    if (!response.ok) {
      let detail = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text)
        detail = parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? detail
      } catch {
        if (contentType.includes('text/html')) {
          detail = '返回了网页而不是 JSON：这个地址可能是 Saber 前端，而不是后端 API'
        }
      }
      throw new SaberError(`Saber 请求失败（HTTP ${response.status}，${path}）：${detail}`, {
        code: 'SABER_HTTP_ERROR',
        status: response.status,
        path,
      })
    }

    if (contentType.includes('text/html')) {
      throw new SaberError(`Saber 返回了 HTML（${path}）：接口路径不匹配当前版本`, {
        code: 'SABER_NOT_JSON',
        path,
      })
    }
    if (text.length === 0) return null
    try {
      return JSON.parse(text)
    } catch {
      throw new SaberError(`Saber 返回了无法解析的内容（${path}）`, { code: 'SABER_BAD_JSON', path })
    }
  }

  /** Binary request (images). Returns `{ buffer, contentType }`. */
  async function requestBuffer(url, options = {}) {
    const response = await send(url, { ...options, headers: { Accept: 'image/*,*/*' } })
    if (!response.ok) {
      throw new SaberError(`读取 Saber 资源失败（HTTP ${response.status}）`, {
        code: 'SABER_HTTP_ERROR',
        status: response.status,
        path: url,
      })
    }
    const array = await response.arrayBuffer()
    return {
      buffer: Buffer.from(array),
      contentType: (response.headers.get('content-type') ?? 'application/octet-stream').split(';', 1)[0],
    }
  }

  return { baseUrl, request, requestBuffer, absolute }
}
