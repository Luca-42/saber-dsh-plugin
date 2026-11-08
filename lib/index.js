/**
 * Host half of the Saber-Translator DSH plugin.
 *
 * P0: read-only status / shelf / book / jobs.
 * P1: v2 job chain (translate, inspect, control), page images, glossary,
 *     backend lifecycle (detect → start via Launcher → stop only own process).
 *
 * Export shape follows the cordis host-plugin convention: `name` / `inject` /
 * `apply`, no default export, and no runtime @deepseek-ai imports.
 *
 * Configuration: `<DSH_HOME>/saber-plugin.config.json`, overridable with
 * SABER_BASE_URL / SABER_INSTALL_PATH / SABER_DATA_DIR env vars.
 *
 * @module dsh-plugin-saber
 */

import { createAdapterResolver } from './adapters/index.js'
import { loadConfig } from './config.js'
import { createSaberClient } from './saber-client.js'
import { createSupervisor } from './supervisor.js'
import { registerSaberTools } from './tools/index.js'

/** Cordis plugin name (matches the bundle row in cordis.patch.yml). */
export const name = 'dsh-plugin-saber'

/** Required host services. */
export const inject = ['tools']

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const config = loadConfig()
  const client = createSaberClient({ baseUrl: config.baseUrl, timeoutMs: config.requestTimeoutMs })
  const supervisor = createSupervisor({ config, client })
  const resolver = createAdapterResolver({ client, config, supervisor })

  const deps = {
    config,
    client,
    supervisor,
    getAdapter: options => resolver.resolve(options),
    invalidateAdapter: () => resolver.invalidate(),
  }

  const disposers = registerSaberTools(ctx, deps)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) dispose()
    }, 'dsh-plugin-saber: tools')
  }
}
