import test from 'node:test'
import assert from 'node:assert/strict'
import { isVisibleUserMessage } from '../src/client/conversation'

test('session-reference 上下文不会被当成用户气泡', () => {
  assert.equal(isVisibleUserMessage({ source: { kind: 'user' } }), true)
  assert.equal(isVisibleUserMessage({ source: { kind: 'session-reference', form: 'recall' } }), false)
})

test('旧日志缺失 source 时保持兼容', () => {
  assert.equal(isVisibleUserMessage({ content: [{ type: 'text', text: 'legacy' }] }), true)
  assert.equal(isVisibleUserMessage(null), true)
})
