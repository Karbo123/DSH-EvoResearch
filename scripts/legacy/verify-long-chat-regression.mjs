#!/usr/bin/env node
/** RET-10: fixed corpus, precise fragment recall and adjacent raw reading. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ResearchMemoryStore } from '../packages/evoresearch-plugin/src/host/memory/store.ts'
import { backfillFragmentIndex } from '../packages/evoresearch-plugin/src/host/memory/backfill.ts'
import { expandFragmentHit, readConversationRange } from '../packages/evoresearch-plugin/src/host/memory/read.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-long-chat-'))
const corpus = JSON.parse(fs.readFileSync(path.resolve('fixtures/long-chat-regression.json'), 'utf8'))
const store = ResearchMemoryStore.open(path.join(root, 'memories'))
const check = (condition, message) => assert.ok(condition, message)
try {
  for (const session of corpus.sessions) {
    for (const [index, turn] of session.turns.entries()) {
      const turnId = `${session.id}-turn-${index + 1}`
      store.createPendingTurn({ turnId, sessionId: session.id, workspaceDir: root, userText: turn.user, categories: ['general'], topicKeys: [] })
      store.updateTurn(turnId, { status: 'completed', assistantText: turn.assistant })
      store.archiveTurn(store.getTurn(turnId))
    }
  }
  const first = await backfillFragmentIndex(store, { memoryDir: path.join(root, 'memories'), projectId: 'regression' })
  const second = await backfillFragmentIndex(store, { memoryDir: path.join(root, 'memories'), projectId: 'regression', sourceVersion: 'rerun' })
  check(first.built === 6 && second.skipped === 6, '固定语料片段回填可继续且幂等')

  const hits = store.searchFragments('编剧 档期', 10)
  check(hits.length > 0, '用与问题相近的自然语言命中长聊天')
  check(hits.every((hit) => hit.fragment.sessionId === 'regression-drama'), '相似分支不会串入命中')
  const expanded = expandFragmentHit(store, hits[0].fragment, hits[0].score)
  check(expanded.snippet.includes('编剧') && expanded.snippet.includes('平台'), '命中包含具体因果原文')
  check(expanded.prev.length + expanded.next.length > 0, '命中自动带前后文')

  const range = readConversationRange(store, 'regression-drama', { anchor: { turnId: hits[0].fragment.turnId, segSeq: hits[0].fragment.segSeq }, before: 1, after: 1 })
  check(range.items.length >= 2 && range.items.every((item) => item.turnId.startsWith('regression-drama-')), '指定会话范围读取不会跨分支')
  console.log(JSON.stringify({ ok: true, corpus: corpus.name, first, second, hit: hits[0].fragment, range: range.items.length }, null, 2))
} finally {
  store.close()
  fs.rmSync(root, { recursive: true, force: true })
}
