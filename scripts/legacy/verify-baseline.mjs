#!/usr/bin/env node
/** BASE-01..04: isolated, repeatable baseline probe. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ResearchMemoryStore } from '../packages/evoresearch-plugin/src/host/memory/store.ts'
import { ChatGraphService } from '../packages/evoresearch-plugin/src/host/chat-graph.ts'
import { ExperimentWorkspaceService } from '../packages/evoresearch-plugin/src/host/experiment-workspace.ts'
import { ProjectEnvService } from '../packages/evoresearch-plugin/src/host/project-env.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-baseline-'))
const project = path.join(root, 'projects', 'baseline')
fs.mkdirSync(project, { recursive: true })
const previousDshHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const checks = []
const check = (ok, message) => {
  assert.ok(ok, message)
  checks.push(message)
}

try {
  const memoryDir = path.join(project, '.evoresearch-data', 'memories')
  const store = ResearchMemoryStore.open(memoryDir)
  store.createPendingTurn({ turnId: 'baseline-turn', sessionId: 'baseline-session', workspaceDir: project, userText: '基线原文', categories: ['general'], topicKeys: [] })
  store.updateTurn('baseline-turn', { assistantText: '基线回答', status: 'completed' })
  store.archiveTurn(store.getTurn('baseline-turn'))
  store.buildTurnFragments('baseline-turn')
  check(store.getTurn('baseline-turn')?.assistantText === '基线回答', 'memory 原文可写回并归档')
  check(store.searchFragments('基线', 5).length > 0, 'memory 片段索引可搜索')
  store.close()

  const graph = new ChatGraphService(root)
  const chat = graph.addNode('baseline', { type: 'chat', title: '基线聊天', x: 0, y: 0, sessionId: 'baseline-session' })
  const note = graph.addNode('baseline', { type: 'resource', displayKind: 'note', title: '基线笔记', x: 160, y: 0, content: '基线资料' })
  graph.addEdge('baseline', { from: note.id, to: chat.id, toPort: 'memory', behavior: 'reference', enabled: true })
  check(graph.get('baseline').nodes.length === 2, 'Chat Graph 节点可持久化')
  check(graph.get('baseline').edges.length === 1, 'Chat Graph reference 边可持久化')

  const workspace = new ExperimentWorkspaceService({ dataRoot: root })
  const experiment = workspace.createWorkspace('baseline', 'baseline experiment')
  check(fs.existsSync(path.join(experiment.dir, 'LAB_NOTE.md')), '实验工作区创建自由格式 LAB_NOTE.md')
  check(!fs.existsSync(path.join(experiment.dir, 'phases', 'phase-0')), '新实验不隐式创建 phase-0')

  const env = new ProjectEnvService({ dataRoot: root, run: async () => ({ status: 0, stdout: '', stderr: '' }) })
  check(env.fingerprint(project) === env.fingerprint(project), '环境指纹计算稳定')

  const result = { ok: true, root, project, checks, generatedAt: new Date().toISOString() }
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-dev')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'baseline-result.json'), JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
  } catch (error) {
    // Windows can briefly retain a SQLite directory handle under WSL/Node
    // interop. The probe must not turn a passed isolation check into a false
    // failure; leave the exact temp path for the host cleanup service.
    console.warn(`baseline temp cleanup deferred: ${root} (${String(error)})`)
  }
}
