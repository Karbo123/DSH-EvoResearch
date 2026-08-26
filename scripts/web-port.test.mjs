import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'

import { findAvailablePort, isPortAvailable, parsePort } from './web-port.mjs'

test('空闲时优先使用 3081', async () => {
  assert.equal(await findAvailablePort(3081, async () => true), 3081)
})

test('首选端口被占用时选择下一个端口', async () => {
  const occupied = new Set([3081])
  assert.equal(
    await findAvailablePort(3081, async (port) => !occupied.has(port)),
    3082,
  )
})

test('自动搜索不会选择官方 DSH 的 3080', async () => {
  assert.equal(await findAvailablePort(3079, async () => true), 3079)
  assert.equal(await findAvailablePort(3080, async () => true), 3081)
})

test('非法端口和 3080 会被拒绝', () => {
  assert.equal(parsePort('3081'), 3081)
  assert.throws(() => parsePort('0'), /无效端口/)
  assert.throws(() => parsePort('65536'), /无效端口/)
  assert.throws(() => parsePort('3080'), /保留给官方原版 DSH/)
})

test('实际已监听的端口会被识别为不可用', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.equal(await isPortAvailable(address.port), false)
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})
