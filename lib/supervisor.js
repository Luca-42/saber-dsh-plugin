/**
 * Backend supervisor: detect a running Saber, optionally start one, and stop
 * only what this plugin started.
 *
 * Saber 3.5+ is a Launcher process that owns the API and Worker children; the
 * plugin therefore starts `Saber-Translator.exe --role launcher ...` and waits
 * for `/api/v2/health` instead of spawning API/Worker directly (those require
 * Launcher-issued epoch identities).
 *
 * @module dsh-plugin-saber/supervisor
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { probeFlavor } from './adapters/index.js'

const EXE_NAME = 'Saber-Translator.exe'
const READY_TIMEOUT_MS = 90_000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @param {{ config: any, client: any }} deps
 */
export function createSupervisor({ config, client }) {
  let startedPid = null

  function port() {
    try {
      const url = new URL(config.baseUrl)
      return Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    } catch {
      return 5000
    }
  }

  /** Resolve the Saber executable from the configured install path. */
  function resolveExe() {
    const configured = String(config.installPath ?? '').trim()
    if (configured.length === 0) return null
    if (!existsSync(configured)) return null
    const stat = statSync(configured)
    if (stat.isFile()) return configured
    const candidate = join(configured, EXE_NAME)
    return existsSync(candidate) ? candidate : null
  }

  /** Probe the backend without starting anything. */
  async function probe() {
    return probeFlavor(client)
  }

  /**
   * Current backend state.
   * @returns {Promise<{running: boolean, flavor: string, startedByUs: boolean, exe: string|null, pid: number|null}>}
   */
  async function status() {
    const probeResult = await probe()
    return {
      running: probeResult.flavor !== 'unknown',
      flavor: probeResult.flavor,
      startedByUs: startedPid !== null,
      exe: resolveExe(),
      pid: startedPid,
    }
  }

  /**
   * Ensure a backend is reachable; start one when configured.
   * @returns {Promise<{flavor: string, started: boolean, pid?: number, error?: string}>}
   */
  async function ensureRunning() {
    const current = await probe()
    if (current.flavor !== 'unknown') {
      return { flavor: current.flavor, started: false }
    }

    const exe = resolveExe()
    if (!exe) {
      return {
        flavor: 'unknown',
        started: false,
        error: config.installPath
          ? `安装路径里找不到 ${EXE_NAME}：${config.installPath}`
          : '未配置 Saber 安装路径（saber-plugin.config.json 的 installPath）',
      }
    }
    if (startedPid !== null) {
      return { flavor: 'unknown', started: true, pid: startedPid, error: '已启动但仍在等待就绪' }
    }

    const args = ['--role', 'launcher', '--host', '127.0.0.1', '--port', String(port()), '--no-browser']
    if (config.dataDir) args.push('--data-dir', String(config.dataDir))

    let child
    try {
      child = spawn(exe, args, {
        cwd: dirname(exe),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    } catch (error) {
      return { flavor: 'unknown', started: false, error: `启动失败：${error?.message ?? error}` }
    }
    startedPid = child.pid ?? null

    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(1000)
      const result = await probe()
      if (result.flavor !== 'unknown') {
        return { flavor: result.flavor, started: true, pid: startedPid ?? undefined }
      }
    }
    return {
      flavor: 'unknown',
      started: true,
      pid: startedPid ?? undefined,
      error: `已启动 PID ${startedPid}，但 ${READY_TIMEOUT_MS / 1000}s 内未就绪（看 Saber 日志）`,
    }
  }

  /** Stop ONLY the process tree this plugin started. */
  async function stop() {
    if (startedPid === null) return { stopped: false, reason: '当前实例不是插件启动的，未执行停止' }
    const pid = startedPid
    startedPid = null
    return new Promise(resolve => {
      try {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.on('exit', () => resolve({ stopped: true, pid }))
        killer.on('error', error => resolve({ stopped: false, reason: String(error?.message ?? error) }))
      } catch (error) {
        resolve({ stopped: false, reason: String(error?.message ?? error) })
      }
    })
  }

  return { probe, status, ensureRunning, stop, resolveExe, port }
}
