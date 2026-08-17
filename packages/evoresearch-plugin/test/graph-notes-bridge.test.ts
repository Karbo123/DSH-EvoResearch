/**
 * GRAPH-06 桥接核对测试（t30：convertToNote × NotesService 接口核对）。
 *
 * 核对结论（对照 notes.ts 实际交付）：
 * - NotesService.createNote(input: { workspaceDir?: string; title?: string; body: string }): NoteMeta
 *   ——与 chat-graph.ts 的 NoteWriter 结构接口逐字段兼容（参数一致；NoteMeta 含
 *   noteId/fileName），无需适配层；
 * - 存储布局：createNote 写 <base>/.evoresearch-data/memories/notes/<fileName>
 *   （base = workspaceDir，或 dataRoot 回退）——与 ChatGraphService.previewOf 的
 *   note 相对路径解析（同 base 规则 + 'memories/notes'）完全一致；
 * - convertToNote 把 createNote 返回的 fileName 直接作为 ref.path（相对笔记目录），
 *   previewOf 可据此读回同一文件。
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ChatGraphService } from '../src/host/chat-graph.js'
import { NotesService } from '../src/host/notes.js'

describe('GRAPH-06 桥接：convertToNote × NotesService（t30 接口核对）', () => {
  let dataRoot: string
  let projectDir: string
  let svc: ChatGraphService

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-bridge-'))
    projectDir = path.join(dataRoot, 'projects', 'demo')
    fs.mkdirSync(projectDir, { recursive: true })
    svc = new ChatGraphService(dataRoot)
  })

  it('与 NotesService 同构的假 createNote：调用参数正确、节点转 ref note、content 保留快照', () => {
    const node = svc.addNode('demo', {
      type: 'memory', title: '旧想法', x: 0, y: 0, scope: 'project', content: '# 旧想法\n\n一段内嵌内容',
    })
    const calls: Array<{ workspaceDir?: string; title?: string; body: string }> = []
    const fakeNotes = {
      createNote(input: { workspaceDir?: string; title?: string; body: string }) {
        calls.push(input)
        return { noteId: 'old-idea-a1b2c3d4', fileName: 'old-idea-a1b2c3d4.md' }
      },
    }
    const result = svc.convertToNote('demo', node.id, projectDir, fakeNotes)
    assert.equal(result.ok, true)
    // createNote 调用参数：workspaceDir 透传、title=节点标题、body=节点内嵌内容
    assert.deepEqual(calls, [{ workspaceDir: projectDir, title: '旧想法', body: '# 旧想法\n\n一段内嵌内容' }])
    // 节点转为 ref note（fileName 作为相对笔记目录路径），content 保留为快照
    assert.deepEqual(result.node.ref, { kind: 'note', path: 'old-idea-a1b2c3d4.md' })
    assert.equal(result.node.content, '# 旧想法\n\n一段内嵌内容')
    // 落盘可回读
    assert.deepEqual(svc.get('demo').nodes.find((n) => n.id === node.id)?.ref, { kind: 'note', path: 'old-idea-a1b2c3d4.md' })
  })

  it('真实 NotesService 端到端：createNote 写盘 → convertToNote → previewOf 读回笔记内容', () => {
    const notes = new NotesService(dataRoot)
    const node = svc.addNode('demo', {
      type: 'memory', title: '实验想法', x: 0, y: 0, scope: 'project', content: '正文内容 A',
    })
    const result = svc.convertToNote('demo', node.id, projectDir, notes)
    assert.equal(result.ok, true)
    // 真实笔记文件落在 NotesService 布局：<workspaceDir>/.evoresearch-data/memories/notes/<fileName>
    const noteFile = path.join(projectDir, '.evoresearch-data', 'memories', 'notes', result.fileName)
    assert.equal(fs.existsSync(noteFile), true)
    // previewOf 以同一 fileName 作 ref.path 读回（路径解析与 notes 布局一致）
    const updated = svc.get('demo').nodes.find((n) => n.id === node.id)!
    const preview = svc.previewOf(updated, projectDir)
    assert.equal(preview.ok, true)
    assert.equal(preview.path, noteFile)
    assert.ok((preview.text ?? '').includes('正文内容 A'))
  })

  it('previewOf note 路径解析：无 workspaceDir 时回退 dataRoot 布局（与 NotesService 同规则）', () => {
    const notes = new NotesService(dataRoot)
    const node = svc.addNode('demo', {
      type: 'memory', title: '回退布局', x: 0, y: 0, scope: 'project', content: '内容 B',
    })
    // 无 workspaceDir：NotesService 落到 dataRoot 布局
    const result = svc.convertToNote('demo', node.id, undefined, notes)
    assert.equal(result.ok, true)
    const noteFile = path.join(dataRoot, '.evoresearch-data', 'memories', 'notes', result.fileName)
    assert.equal(fs.existsSync(noteFile), true)
    const updated = svc.get('demo').nodes.find((n) => n.id === node.id)!
    const preview = svc.previewOf(updated, undefined)
    assert.equal(preview.ok, true)
    assert.equal(preview.path, noteFile)
  })

  it('createNote 抛错时 convertToNote 向上传播，图不留半成品引用', () => {
    const node = svc.addNode('demo', {
      type: 'memory', title: 'X', x: 0, y: 0, scope: 'project', content: '内容',
    })
    const badNotes = { createNote() { throw new Error('笔记写入失败') } }
    assert.throws(() => svc.convertToNote('demo', node.id, projectDir, badNotes), /笔记写入失败/)
    // 图未被改动（save 未执行，节点仍是内嵌文本）
    assert.equal(svc.get('demo').nodes.find((n) => n.id === node.id)?.ref, undefined)
  })
})
