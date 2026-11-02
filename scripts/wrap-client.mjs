/**
 * Wraps the CJS browser build into the client-modules factory form:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })
 *
 * The factory's `require` resolves the host's shared module table (react,
 * react-dom, @deepseek-ai/*); everything else is already inlined by tsdown.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const id = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name
const body = readFileSync(resolve(root, 'lib/client.bundle.js'), 'utf8')

const wrapped = `/* ${id} — browser half (generated wrapper; see scripts/wrap-client.mjs) */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
${body
  .split('\n')
  .map((line) => (line === '' ? '' : `    ${line}`))
  .join('\n')}
    return module.exports
  },
})
`

writeFileSync(resolve(root, 'lib/client.js'), wrapped)
process.stdout.write(`client: wrapped ${body.length} bytes -> lib/client.js\n`)
