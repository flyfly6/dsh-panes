/**
 * One runnable check for the host half: the route serves the plugin page and
 * nobody else. Runs against the built bundle, so a broken build fails here.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { createHandler } from '../lib/index.js'

const PLUGIN = 'dsh-workbench'
let server
let port

before(async () => {
  server = createServer(createHandler(() => ({ startup: 'workspace' })))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(() => server.close())

function send({ method = 'POST', body, raw, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/dsh-workbench/api',
        method,
        headers: {
          'content-type': 'application/json',
          'x-dsh-plugin': PLUGIN,
          ...headers,
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: text === '' ? null : JSON.parse(text) }))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

test('ping answers for the plugin page', async () => {
  const res = await send({ body: { op: 'ping' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.data.plugin, PLUGIN)
})

test('a request without the plugin header is refused', async () => {
  const res = await send({ body: { op: 'ping' }, headers: { 'x-dsh-plugin': 'something-else' } })
  assert.equal(res.status, 403)
  assert.equal(res.body.code, 'forbidden')
})

test('a cross-site request is refused even with the header', async () => {
  const res = await send({
    body: { op: 'ping' },
    headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(res.status, 403)
})

test('non-POST methods are refused', async () => {
  assert.equal((await send({ method: 'GET' })).status, 405)
})

test('unknown ops name themselves', async () => {
  const res = await send({ body: { op: 'git.status' } })
  assert.equal(res.status, 404)
  assert.equal(res.body.code, 'unknown-op')
})

test('a body without an op is an unknown op', async () => {
  const res = await send({ body: {} })
  assert.equal(res.body.ok, false)
  assert.equal(res.body.code, 'unknown-op')
})

test('unparseable JSON is a bad-request, not a crash', async () => {
  const res = await send({ raw: '{not json' })
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'bad-request')
})
