/**
 * Tool registration for the Saber plugin.
 *
 * P0 tools stay read-only; P1 adds the v2 job chain (translate / jobs / job /
 * job_control) and backend lifecycle. Every write tool is direct-execution by
 * request (no per-call confirmation), so each one reports exactly what it did.
 *
 * @module dsh-plugin-saber/tools
 */

import { backendTools } from './backend.js'
import { contentTools } from './content.js'
import { jobTools } from './jobs.js'
import { mediaTools } from './media.js'

/**
 * @param {{ tools: { register: (tool: unknown) => unknown } }} ctx
 * @param {{
 *   getAdapter: (options?: {refresh?: boolean, autoStart?: boolean}) => Promise<any>,
 *   supervisor: any,
 *   client: any,
 *   config: any,
 * }} deps
 * @returns {Array<() => void>} disposers
 */
export function registerSaberTools(ctx, deps) {
  const tools = [
    ...contentTools(deps),
    ...jobTools(deps),
    ...mediaTools(deps),
    ...backendTools(deps),
  ]
  return tools.map(tool => ctx.tools.register(tool))
}
