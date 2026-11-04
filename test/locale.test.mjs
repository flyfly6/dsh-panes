/* Every t('key') in the source must exist in src/locale.ts — the translator
   echoes unknown keys verbatim, and typecheck cannot see through t(). */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : walk(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

test('every key used by t() is defined in the dictionary', () => {
  const locale = readFileSync(join(root, 'src/locale.ts'), 'utf8')
  const zh = locale.slice(0, locale.indexOf('export const en'))
  const defined = new Set([...zh.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]))

  const missing = new Set()
  for (const file of walk(join(root, 'src'))) {
    if (file.endsWith('locale.ts')) continue
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('([a-z][\w]*\.[\w.]+)'\)/g)) {
      if (!defined.has(match[1])) missing.add(`${match[1]} (${file.slice(root.length + 1)})`)
    }
  }
  assert.deepEqual([...missing], [])
})

test('the two dictionaries carry the same keys', () => {
  const locale = readFileSync(join(root, 'src/locale.ts'), 'utf8')
  const [zh, en] = [locale.slice(0, locale.indexOf('export const en')), locale.slice(locale.indexOf('export const en'))]
  const keys = (text) => [...text.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]).sort()
  assert.deepEqual(keys(en), keys(zh))
})
