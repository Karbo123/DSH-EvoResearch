/**
 * LIB-GRAPH 引用接口核对测试（任务 t31）。
 *
 * 核对对象：
 * - library/search.ts 的 toGraphRef / resolveRef（lib 所有权）；
 * - chat-graph.ts 的 GraphNodeRef（graph 所有权，只读使用、不修改）：
 *   { kind: 'note' | 'file' | 'pdf' | 'dir', path: string }。
 *
 * 断言内容：
 * 1. toGraphRef 输出与 GraphNodeRef 形状兼容（类型可赋值 + 运行时字段齐全，
 *    以「消费 GraphNodeRef 的函数」验证，并真实调用 ChatGraphService.previewOf
 *    模拟图节点消费：pdf 引用返回「打开提示」，不解析内容）；
 * 2. resolveRef 路径解析：绝对路径 / 相对项目路径 / 大小写不敏感 / paperId 优先 /
 *    缺失返回 undefined / note 引用携带笔记；
 * 3. PDF 打开后的页级定位读取链（graph pdf 节点 → library 端点）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { GraphNodeRef } from '../src/host/chat-graph.js'
import { ChatGraphService } from '../src/host/chat-graph.js'
import { WorkspaceService } from '../src/host/workspace.js'
import { LibraryIndexer, LibrarySearch } from '../src/host/library/index.js'

// ── 夹具 ────────────────────────────────────────────────────────────────────

interface Fixture {
  tmp: string
  dataRoot: string
  project: string
  projectPath: string
  pdfDir: string
  indexer: LibraryIndexer
  search: LibrarySearch
  chatGraph: ChatGraphService
}

function setup(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-graphref-'))
  const dataRoot = path.join(tmp, 'data')
  const workspace = new WorkspaceService({ dataRoot })
  const project = workspace.createProject('demo').name
  const projectPath = workspace.projectPath(project)
  const pdfDir = path.join(projectPath, 'papers')
  fs.mkdirSync(pdfDir, { recursive: true })
  const indexer = new LibraryIndexer({
    dataRoot,
    extractor: async () => ({ pages: ['Attention Graph 图注意力网络。\n特征定位页正文。'] }),
  })
  const search = new LibrarySearch({ dataRoot })
  const chatGraph = new ChatGraphService(dataRoot)
  return { tmp, dataRoot, project, projectPath, pdfDir, indexer, search, chatGraph }
}

function cleanup(fixture: Fixture): void {
  fixture.indexer.dispose()
  fixture.search.dispose()
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(fixture.tmp, { recursive: true, force: true })
      return
    } catch {
      // Windows 文件锁瞬时重试
    }
  }
}

// ── 测试 ────────────────────────────────────────────────────────────────────

describe('LIB-GRAPH 引用接口核对', () => {
  let fixture: Fixture
  let pdf: string
  let paperId: string

  beforeEach(async () => {
    fixture = setup()
    pdf = path.join(fixture.pdfDir, 'attention-graph.pdf')
    fs.writeFileSync(pdf, 'fake pdf bytes', 'utf8')
    const result = await fixture.indexer.addPaper(fixture.project, pdf)
    paperId = result.paperId
  })

  afterEach(() => cleanup(fixture))

  it('toGraphRef 输出与 GraphNodeRef 形状兼容（类型 + 字段齐全）', () => {
    const ref = fixture.search.toGraphRef(fixture.project, { kind: 'paper', paperId })
    assert.ok(ref, 'toGraphRef 应解析到已注册论文')

    // 类型级核对：消费 GraphNodeRef 的函数接受 toGraphRef 结果（编译期可赋值），
    // 运行时再验证字段齐全（无缺字段、无多余字段）。
    function consumeGraphNodeRef(graphRef: GraphNodeRef): { kind: string; path: string } {
      assert.equal(typeof graphRef.kind, 'string')
      assert.equal(typeof graphRef.path, 'string')
      assert.ok(graphRef.path.length > 0)
      return { kind: graphRef.kind, path: graphRef.path }
    }
    const consumed = consumeGraphNodeRef(ref)
    assert.deepEqual(Object.keys(ref).sort(), ['kind', 'path'], 'ref 应恰好含 kind/path 两字段')
    assert.equal(consumed.kind, 'pdf')

    // kind 取值必须落在 GraphNodeRef 联合类型内
    const graphKinds: GraphNodeRef['kind'][] = ['note', 'file', 'pdf', 'dir']
    assert.ok(graphKinds.includes(ref.kind), `kind='${ref.kind}' 必须是 GraphNodeRef 的合法取值`)

    // path 语义：GraphNodeRef 允许「相对项目工作区或绝对路径」——绝对路径合法，
    // 且文件真实存在（graph previewOf 可 stat）
    assert.ok(path.isAbsolute(ref.path), 'toGraphRef 返回绝对路径（合法且无歧义）')
    assert.equal(ref.path, pdf)
    assert.ok(fs.existsSync(ref.path))
  })

  it('toGraphRef 结果可作为图节点 ref 被 previewOf 消费（pdf 返回打开提示、不解析内容）', () => {
    const nodeRef: GraphNodeRef | undefined = fixture.search.toGraphRef(fixture.project, { kind: 'paper', path: pdf })
    assert.ok(nodeRef)

    // 模拟 graph previewOf 的路径解析：绝对路径直接使用（与 chat-graph.ts 一致）
    let target = nodeRef.path
    if (!path.isAbsolute(target)) target = path.join(fixture.projectPath, target)
    assert.equal(target, pdf)
    assert.ok(fs.statSync(target).isFile())

    // 真实 graph 消费：pdf 引用 → 二进制「打开提示」（graph 不解析 PDF 内容）
    const preview = fixture.chatGraph.previewOf(
      { id: 'n1', type: 'memory', title: '论文', x: 0, y: 0, ref: nodeRef },
      fixture.projectPath,
    )
    assert.equal(preview.ok, false)
    assert.equal(preview.path, pdf)
    assert.ok(preview.error?.includes('二进制'), `应为二进制打开提示，实际: ${preview.error}`)
    assert.ok(preview.error?.includes('打开'))
  })

  it('resolveRef 路径解析：绝对 / 相对项目 / 大小写不敏感 / paperId 优先', async () => {
    const search = fixture.search
    // 绝对路径
    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', path: pdf })?.paperId, paperId)
    // 相对项目目录路径（反斜杠）
    const relative = path.relative(fixture.projectPath, pdf)
    assert.ok(!path.isAbsolute(relative))
    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', path: relative })?.paperId, paperId)
    // 大小写不敏感（fileKey 经 normPath 归一化，全平台一致）
    const weirdCase = pdf.toUpperCase().replace(/\\/g, '/')
    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', path: weirdCase })?.paperId, paperId)
    // paperId 优先于 path：同时给两者时解析到 paperId 指向的论文
    const pdfB = path.join(fixture.pdfDir, 'second.pdf')
    fs.writeFileSync(pdfB, 'fake pdf bytes', 'utf8')
    const { paperId: paperIdB } = await fixture.indexer.addPaper(fixture.project, pdfB)
    const resolved = search.resolveRef(fixture.project, { kind: 'paper', paperId, path: pdfB })
    assert.equal(resolved?.paperId, paperId)
    assert.notEqual(paperIdB, paperId)
  })

  it('resolveRef 缺失返回 undefined；note 引用携带笔记内容', async () => {
    const search = fixture.search
    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', paperId: 'missing-id' }), undefined)
    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', path: 'no/such/file.pdf' }), undefined)
    assert.equal(search.resolveRef(fixture.project, { kind: 'note', paperId: 'missing-id' }), undefined)

    const notes = '# 精读笔记\n图注意力机制值得借鉴。'
    await fixture.indexer.setNotes(fixture.project, paperId, notes)
    const noteRef = search.resolveRef(fixture.project, { kind: 'note', paperId })
    assert.equal(noteRef?.kind, 'note')
    assert.equal(noteRef?.paperId, paperId)
    assert.equal(noteRef?.path, pdf) // 笔记暂存镜像，path 仍为论文路径
    assert.equal(noteRef?.notes, notes)
    assert.equal(noteRef?.title, 'Attention Graph 图注意力网络') // 标题启发式剥尾随句号

    // note 不产生图节点（笔记在镜像，无独立文件路径；落文件后接 kind 'note'）
    assert.equal(search.toGraphRef(fixture.project, { kind: 'note', paperId }), undefined)
    assert.equal(search.toGraphRef(fixture.project, { kind: 'paper', paperId: 'missing-id' }), undefined)
  })

  it('PDF 打开后的页级定位读取链（graph pdf ref → library 端点）', async () => {
    // 图节点拿到 pdf ref（第 2 个用例已验 previewOf 打开提示）
    const nodeRef = fixture.search.toGraphRef(fixture.project, { kind: 'paper', paperId })
    assert.ok(nodeRef)
    // 前端双击打开 → 经 library 端点按页定位：
    // 1) path → paperId 反查
    const resolved = fixture.search.resolveRef(fixture.project, { kind: 'paper', path: nodeRef.path })
    assert.equal(resolved?.paperId, paperId)
    // 2) 整页文本读取
    const page = fixture.search.getPageText(fixture.project, paperId, 1)
    assert.equal(page?.filePath, pdf)
    assert.ok(page?.text.includes('特征定位页正文'))
    // 3) 页级命中（页码+片段）
    const hits = fixture.search.scanPages(fixture.project, '特征', { paperId })
    assert.ok(hits.length >= 1)
    assert.equal(hits[0]!.page, 1)
    assert.ok(hits[0]!.snippet.includes('特征定位页正文'))
    // 4) 原文精确片段（引用核对）
    const offset = page!.text.indexOf('特征')
    const range = fixture.search.getTextRange(fixture.project, paperId, 1, offset, 2)
    assert.equal(range.text, '特征')
  })
})
