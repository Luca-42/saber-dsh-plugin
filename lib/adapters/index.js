/**
 * Adapter resolution: probe the backend, pick the API generation, cache briefly.
 *
 * @module dsh-plugin-saber/adapters
 */

import { createLegacyAdapter } from './legacy.js'
import { createV2Adapter } from './v2.js'

const CACHE_TTL_MS = 30_000

/**
 * Probe which API generation answers at the configured base URL.
 * @returns {Promise<{flavor: 'v2'|'legacy'|'unknown', health?: any, serverInfo?: any}>}
 */
export async function probeFlavor(client) {
  try {
    const health = await client.request('/api/v2/health', { timeoutMs: 2500 })
    if (health && (health.status === 'ok' || health.status === 'fenced' || health.role === 'api')) {
      return { flavor: 'v2', health }
    }
  } catch {
    // Not a v2 backend (404) or not reachable — try the legacy probe.
  }
  try {
    const serverInfo = await client.request('/api/server-info', { timeoutMs: 2500 })
    if (serverInfo && (serverInfo.success === true || serverInfo.port !== undefined)) {
      return { flavor: 'legacy', serverInfo }
    }
  } catch {
    // Unknown / offline.
  }
  return { flavor: 'unknown' }
}

/**
 * Lazy, cached adapter resolution with optional auto-start.
 * @param {{ client: import('../saber-client.js').createSaberClient extends (...a:any)=>infer R ? R : any, config: any, supervisor: any }} deps
 */
export function createAdapterResolver({ client, config, supervisor }) {
  let cached = { adapter: null, at: 0 }

  async function resolve({ refresh = false, autoStart = true } = {}) {
    if (!refresh && cached.adapter && Date.now() - cached.at < CACHE_TTL_MS) return cached.adapter

    let probe = await probeFlavor(client)
    if (probe.flavor === 'unknown' && autoStart && config.autoStart) {
      const started = await supervisor.ensureRunning()
      if (started && started.flavor && started.flavor !== 'unknown') probe = started
      else probe = await probeFlavor(client)
    }

    const adapter = probe.flavor === 'v2'
      ? createV2Adapter(client)
      : probe.flavor === 'legacy'
        ? createLegacyAdapter(client)
        : null

    cached = { adapter, at: Date.now() }
    return adapter
  }

  function invalidate() {
    cached = { adapter: null, at: 0 }
  }

  function peek() {
    return cached.adapter
  }

  return { resolve, invalidate, peek }
}
