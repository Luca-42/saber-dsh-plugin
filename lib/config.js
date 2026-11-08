/**
 * Plugin configuration: a JSON file under the DSH home plus env overrides.
 *
 * No @deepseek-ai dependency: this half runs inside the DSH host process.
 *
 * @module dsh-plugin-saber/config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:5000'

/** The DSH home directory (`DSH_HOME` overrides `~/.dsh`). */
export function dshHome() {
  const override = process.env.DSH_HOME
  return resolve(override !== undefined && override.length > 0 ? override : join(homedir(), '.dsh'))
}

/** Path of the plugin's config file. */
export function configPath() {
  return process.env.SABER_PLUGIN_CONFIG ?? join(dshHome(), 'saber-plugin.config.json')
}

/** @typedef {{
 *   baseUrl?: string,
 *   installPath?: string,
 *   dataDir?: string,
 *   autoStart?: boolean,
 *   apiFlavor?: 'auto'|'v2'|'legacy',
 *   requestTimeoutMs?: number,
 * }} SaberPluginConfig */

/** Defaults applied when the file is absent. */
export function defaultConfig() {
  return {
    baseUrl: DEFAULT_BASE_URL,
    installPath: '',
    dataDir: '',
    autoStart: false,
    apiFlavor: 'auto',
    requestTimeoutMs: 15000,
  }
}

/** Read the config file, merging defaults and env overrides. */
export function loadConfig() {
  const base = defaultConfig()
  const file = configPath()
  let fromFile = {}
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      fromFile = {}
    }
  }
  const merged = { ...base, ...fromFile }
  if (process.env.SABER_BASE_URL) merged.baseUrl = process.env.SABER_BASE_URL
  if (process.env.SABER_INSTALL_PATH) merged.installPath = process.env.SABER_INSTALL_PATH
  if (process.env.SABER_DATA_DIR) merged.dataDir = process.env.SABER_DATA_DIR
  if (!/^https?:\/\//i.test(String(merged.baseUrl))) merged.baseUrl = DEFAULT_BASE_URL
  return {
    ...merged,
    baseUrl: String(merged.baseUrl).replace(/\/+$/, ''),
    autoStart: merged.autoStart === true,
    requestTimeoutMs: Number.isFinite(merged.requestTimeoutMs) && merged.requestTimeoutMs > 0
      ? merged.requestTimeoutMs
      : base.requestTimeoutMs,
  }
}

/** Persist a partial config patch (used by the setup tool / future settings UI). */
export function saveConfig(patch) {
  const file = configPath()
  const current = loadConfig()
  const next = { ...defaultConfig(), ...current, ...patch }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
