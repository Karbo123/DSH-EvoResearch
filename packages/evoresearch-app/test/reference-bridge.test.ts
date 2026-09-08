import test from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentReferenceRequest, queryReferenceCandidates } from '../src/client/reference-bridge'

test('官方文件与会话 Remote 结果会按来源归一化', async () => {
  const batch = await queryReferenceCandidates({
    fileReferences: {
      async list(agentId, query) {
        assert.equal(agentId, 'session-current')
        assert.equal(query, 'paper')
        return { ok: true, value: [{ path: 'papers/paper.md', kind: 'file' }] }
      },
    },
    sessionReferenceResolver: {
      async candidates(agentId, query) {
        assert.equal(agentId, 'session-current')
        assert.equal(query, 'paper')
        return {
          ok: true,
          value: [{
            sessionId: 'session-source',
            label: 'Paper review',
            sameWorkspace: true,
            createdAt: 1,
            mention: '@[Paper review](dsh-session:InNlc3Npb24tc291cmNlIg)',
          }],
        }
      },
    },
  }, 'session-current', 'paper')

  assert.deepEqual(batch.files, [{ path: 'papers/paper.md', kind: 'file' }])
  assert.equal(batch.sessions[0]?.mention, '@[Paper review](dsh-session:InNlc3Npb24tc291cmNlIg)')
})

test('一个引用来源失败时另一个来源仍可提供候选', async () => {
  const batch = await queryReferenceCandidates({
    fileReferences: { async list() { throw new Error('file index unavailable') } },
    sessionReferenceResolver: {
      async candidates() {
        return { ok: true, value: [{ sessionId: 'source', label: 'Source', sameWorkspace: false, createdAt: 1, mention: '@[Source](dsh-session:InNvdXJjZSI)' }] }
      },
    },
  }, 'current', '')

  assert.deepEqual(batch.files, [])
  assert.equal(batch.sessions.length, 1)
})

test('引号文件查询不会调用会话 Remote', async () => {
  let sessionCalled = false
  const batch = await queryReferenceCandidates({
    fileReferences: { async list() { return { ok: true, value: [{ path: 'paper notes', kind: 'directory' }] } } },
    sessionReferenceResolver: { async candidates() { sessionCalled = true; return { ok: true, value: [] } } },
  }, 'current', 'paper notes', undefined, false)
  assert.equal(sessionCalled, false)
  assert.deepEqual(batch.sessions, [])
  assert.deepEqual(batch.files, [{ path: 'paper notes', kind: 'directory' }])
})

test('缺失会话或取消中的请求不发布候选', async () => {
  let called = false
  const remote = {
    fileReferences: { async list() { called = true; return { ok: true, value: [] } } },
  }
  assert.deepEqual(await queryReferenceCandidates(remote, null, ''), { files: [], sessions: [] })
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await queryReferenceCandidates(remote, 'current', '', controller.signal), { files: [], sessions: [] })
  assert.equal(called, false)
  assert.equal(isCurrentReferenceRequest(2, 2), true)
  assert.equal(isCurrentReferenceRequest(1, 2), false)
  assert.equal(isCurrentReferenceRequest(2, 2, controller.signal), false)
})
