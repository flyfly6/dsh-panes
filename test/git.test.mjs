/**
 * The forked Git half inside the workbench: the route answers, the trust fence
 * holds, and push/pull stay refused until R2.10's opt-in is on.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as gitHost from '../src/git/host.js'

let handler = null
const ctx = {
  effect(run) {
    const off = run()
    return () => {
      if (typeof off === 'function') off()
    }
  },
  inject() {
    /* llm/sessions are optional in the forked apply */
  },
  webServer: {
    register(route) {
      handler = route.handler
      return () => {
        handler = null
      }
    },
  },
}

let server
let port
const repo = mkdtempSync(path.join(tmpdir(), 'wb-git-'))
const fresh = mkdtempSync(path.join(tmpdir(), 'wb-fresh-'))
const plain = mkdtempSync(path.join(tmpdir(), 'wb-nogit-'))

function send(method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `/dsh-ide-git/api/${method}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: text === '' ? null : JSON.parse(text) }))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

before(async () => {
  execFileSync('git', ['init', '-q', '-b', 'wb-test'], { cwd: repo })
  writeFileSync(path.join(repo, 'committed.txt'), 'seed\n')
  execFileSync('git', ['add', 'committed.txt'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'], { cwd: repo })
  writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  writeFileSync(path.join(repo, 'b.txt'), 'two\n')
  execFileSync('git', ['init', '-q', '-b', 'wb-fresh'], { cwd: fresh })
  gitHost.configure({})
  gitHost.apply(ctx, {})
  assert.notEqual(handler, null, 'the forked apply registers its route')
  server = createServer((req, res) => void handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(() => server.close())

test('the git route refuses a non-loopback request without the same-origin marker', async () => {
  const res = await send('summary', { cwd: repo }, { host: 'evil.example:1234' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'forbidden')
})

test('summary reports the branch and the untracked files', async () => {
  const res = await send('summary', { cwd: repo, stats: false })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.ok, true)
  assert.equal(res.body.data.branch, 'wb-test')
  assert.equal(res.body.data.changes.untracked.length, 2)
})

test('a non-repository directory answers a readable error, never a crash', async () => {
  const res = await send('summary', { cwd: plain })
  assert.equal(res.body.ok, false)
  assert.equal(typeof res.body.error.code, 'string')
  assert.match(res.body.error.code, /not-a-repo|no-repo|git/)
})

test('push is refused until experimentalRemoteOps is on', async () => {
  const refused = await send('push', { cwd: repo })
  assert.equal(refused.status, 403)
  assert.equal(refused.body.error.code, 'disabled-by-config')

  gitHost.configure({ experimentalRemoteOps: true })
  const allowed = await send('push', { cwd: repo })
  /* No remote: git itself fails now — the point is the config gate is gone. */
  assert.notEqual(allowed.body?.error?.code, 'disabled-by-config')
  gitHost.configure({})
})

test('commit --push is gated by the same switch', async () => {
  const res = await send('commit', { cwd: repo, message: 'x', push: true })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'disabled-by-config')
})

test('a repository with no commits shows the branch and an empty history', async () => {
  const summary = await send('summary', { cwd: fresh, stats: false })
  assert.equal(summary.body.ok, true, JSON.stringify(summary.body))
  assert.equal(summary.body.data.branch, 'wb-fresh')
  assert.equal(summary.body.data.changes.untracked.length, 0)
  const log = await send('log', { cwd: fresh, limit: 20 })
  assert.equal(log.body.ok, true, JSON.stringify(log.body))
  assert.deepEqual(log.body.data.commits, [])
  assert.equal(log.body.data.hasMore, false)
})
