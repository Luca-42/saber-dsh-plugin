/**
 * Verification harness: mount the plugin against a fake tool registry and
 * exercise the read-only tools against the real local Saber backend.
 *
 * Write tools (saber_translate / saber_job_control / saber_terms set) are
 * exercised only through an explicit call from a live DSH session, never here.
 *
 * Usage: node test/harness.mjs [--base-url http://127.0.0.1:5000]
 */

import process from 'node:process'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base-url')
const baseUrl = baseIndex >= 0 ? args[baseIndex + 1] : 'http://127.0.0.1:5000'
process.env.SABER_BASE_URL = baseUrl
// Keep the harness offline-safe: never auto-start a backend from a test run.
process.env.SABER_PLUGIN_CONFIG = process.env.SABER_PLUGIN_CONFIG ?? ''

const { apply, name, inject } = await import('../lib/index.js')

const tools = new Map()
const ctx = {
  tools: {
    register(tool) {
      if (tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`)
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
  },
  effect(fn) {
    return fn()
  },
}

console.log(`plugin: name=${name} inject=${JSON.stringify(inject)}`)
console.log(`target: ${baseUrl}`)
apply({ ...ctx, tools: ctx.tools })

const expected = [
  'saber_status', 'saber_books', 'saber_book', 'saber_pages',
  'saber_translate', 'saber_jobs', 'saber_job', 'saber_job_control',
  'saber_page_image', 'saber_backend', 'saber_terms',
]
for (const toolName of expected) {
  if (!tools.has(toolName)) throw new Error(`missing tool: ${toolName}`)
}
console.log(`registered: ${[...tools.keys()].join(', ')}`)

/**
 * Structural check for the JSON Schema shipped to the model API. A boolean
 * `required` inside a property makes the provider reject EVERY tool call.
 */
function assertToolSchema(tool) {
  const scope = `tool ${tool.name}`
  const parameters = tool.parameters
  if (!parameters || parameters.type !== 'object') throw new Error(`${scope}: parameters.type must be object`)
  if (!parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) {
    throw new Error(`${scope}: parameters.properties must be an object`)
  }
  if (parameters.required !== undefined && !Array.isArray(parameters.required)) {
    throw new Error(`${scope}: parameters.required must be a string array`)
  }
  for (const name of parameters.required ?? []) {
    if (typeof name !== 'string') throw new Error(`${scope}: required entries must be strings`)
    if (!(name in parameters.properties)) throw new Error(`${scope}: required "${name}" is not a declared property`)
  }
  for (const [key, value] of Object.entries(parameters.properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${scope}: property ${key} must be a schema object`)
    }
    if (value.required !== undefined) {
      throw new Error(`${scope}: property ${key} carries a nested required flag`)
    }
    if (typeof value.type !== 'string' && value.enum === undefined && value.oneOf === undefined) {
      throw new Error(`${scope}: property ${key} has no type`)
    }
  }
  const serialized = JSON.stringify(parameters)
  if (serialized.includes('"required":true') || serialized.includes('"required":false')) {
    throw new Error(`${scope}: serialized parameters contain a boolean required`)
  }
}

for (const tool of tools.values()) {
  assertToolSchema(tool)
}
console.log(`schema ok: ${tools.size} tools`)

function textOf(result) {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result.map(block => block?.text ?? JSON.stringify(block)).join('\n')
  return JSON.stringify(result, null, 2)
}

async function call(toolName, toolArgs = {}) {
  const tool = tools.get(toolName)
  const value = await tool.execute(toolArgs)
  const blocks = tool.output.render(toolArgs, value)
  const text = textOf(blocks)
  console.log(`\n===== ${toolName} ${JSON.stringify(toolArgs)} =====`)
  console.log(text.split('\n').slice(0, 20).join('\n'))
  return text
}

const status = await call('saber_status')
const flavor = status.includes('/api/v2') || status.includes('3.5+') ? 'v2' : 'legacy'
console.log(`\ndetected flavor: ${flavor}`)

const books = await call('saber_books')
const idMatch = books.match(/\b([0-9a-f-]{8,36})\b/i)
if (idMatch) {
  await call('saber_book', { bookId: idMatch[1] })
}

if (flavor === 'v2') {
  await call('saber_jobs', { scope: 'queue', limit: 5 })
} else {
  try {
    await call('saber_jobs', { scope: 'queue' })
    console.error('\nUNEXPECTED: legacy backend accepted a v2 job tool.')
    process.exit(3)
  } catch (error) {
    console.log(`\n===== saber_jobs (expected legacy degradation) =====`)
    console.log(String(error?.message ?? error).split('\n')[0])
  }
}

await call('saber_backend', { action: 'status' })

console.log('\nP1 harness: PASS (schema + read-only tools verified)')
