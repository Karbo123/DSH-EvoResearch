/**
 * 文献精读笔记/参考文献（LIB-04..09）与 LaTeX 写作（WRITE-01..09）测试。
 *
 * 覆盖（纯函数/服务级，不跑 E2E、不实际编译 LaTeX）：
 * - LIB-09：元数据提取失败仍注册可搜索；长 PDF 分页与跨页定位；
 *   references 标题完整保留；Graph 引用结构解析；
 * - LIB-04/05/06/07：笔记与参考文献读写检索、BibTeX 解析/生成/导入、多字段搜索；
 * - WRITE-09：实验运行中继续写作（无门禁）；结果完成后核对数字；
 *   编译错误解析；工具探测与缺工具提示；草稿对比；稿件目录 CRUD 与路径护栏。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceService } from '../src/host/workspace.js'
import { LibraryIndexer, LibrarySearch, parseBibtex, generateBibtex } from '../src/host/library/index.js'
import {
  ManuscriptService,
  parseLatexErrors,
  probeLatexTools,
  findExecutable,
  diffDraftTexts,
  splitParagraphs,
} from '../src/host/manuscript.js'
import type { PdfExtractor } from '../src/host/library/index.js'

// ── 夹具 ────────────────────────────────────────────────────────────────────

interface Fixture {
  tmp: string
  dataRoot: string
  project: string
  projectPath: string
  pdfDir: string
  workspace: WorkspaceService
}

function setup(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-libwrite-'))
  const dataRoot = path.join(tmp, 'data')
  const workspace = new WorkspaceService({ dataRoot })
  const project = workspace.createProject('demo').name
  const projectPath = workspace.projectPath(project)
  const pdfDir = path.join(projectPath, 'papers')
  fs.mkdirSync(pdfDir, { recursive: true })
  return { tmp, dataRoot, project, projectPath, pdfDir, workspace }
}

function cleanup(fixture: Fixture, services: Array<{ dispose(): void }>): void {
  for (const service of services) service.dispose()
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(fixture.tmp, { recursive: true, force: true })
      return
    } catch {
      // Windows 文件锁瞬时重试
    }
  }
}

/** 写入一个假 PDF（内容不重要，注册用）。 */
function writeFakePdf(fixture: Fixture, name: string): string {
  const file = path.join(fixture.pdfDir, name)
  fs.writeFileSync(file, `fake pdf ${name}`, 'utf8')
  return file
}

// ── LIB ─────────────────────────────────────────────────────────────────────

describe('LIB-04/05 精读笔记与参考文献读写检索', () => {
  let fixture: Fixture
  let indexer: LibraryIndexer
  let search: LibrarySearch

  beforeEach(() => {
    fixture = setup()
    indexer = new LibraryIndexer({ dataRoot: fixture.dataRoot })
    search = new LibrarySearch({ dataRoot: fixture.dataRoot })
  })

  afterEach(() => cleanup(fixture, [indexer, search]))

  it('setNotes/getNotes 往返 + 笔记可搜索', async () => {
    const pdf = writeFakePdf(fixture, 'attention.pdf')
    const { paperId } = await indexer.addPaper(fixture.project, pdf)
    const notes = '# 精读笔记（任意结构 Markdown）\n\n## 方法\n\nself-attention 并行化是关键 idea。'
    await indexer.setNotes(fixture.project, paperId, notes)
    assert.equal(indexer.getNotes(fixture.project, paperId), notes)
    const hits = search.search(fixture.project, '并行化')
    assert.equal(hits.length, 1)
    assert.ok(hits[0]!.matchedFields.includes('notes'))
  })

  it('setReferences/getReferences 往返 + 标题完整保留可搜索', async () => {
    const pdf = writeFakePdf(fixture, 'attention.pdf')
    const { paperId } = await indexer.addPaper(fixture.project, pdf)
    const references = [
      'Vaswani et al. 2017: Attention Is All You Need',
      'He et al. 2016: Deep Residual Learning for Image Recognition',
    ]
    await indexer.setReferences(fixture.project, paperId, references)
    assert.deepEqual(indexer.getReferences(fixture.project, paperId), references)
    const hits = search.search(fixture.project, 'Residual Learning')
    assert.equal(hits.length, 1)
    assert.ok(hits[0]!.matchedFields.includes('references'))
    // 标题原样保留（未被压缩/截断）
    assert.ok(hits[0]!.paper.references[0]!.includes('Attention Is All You Need'))
  })
})

describe('LIB-09 元数据提取失败与长 PDF 分页', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setup()
  })

  afterEach(() => cleanup(fixture, []))

  it("提取器抛错（'failed'）仍注册、可按文件名搜索", async () => {
    const indexer = new LibraryIndexer({
      dataRoot: fixture.dataRoot,
      extractor: async () => {
        throw new Error('corrupted pdf')
      },
    })
    const search = new LibrarySearch({ dataRoot: fixture.dataRoot })
    try {
      const pdf = writeFakePdf(fixture, 'broken.pdf')
      const result = await indexer.addPaper(fixture.project, pdf)
      assert.equal(result.status, 'added')
      assert.equal(result.extractionStatus, 'failed')
      assert.ok(result.extractError?.includes('corrupted pdf'))
      const hits = search.search(fixture.project, 'broken')
      assert.equal(hits.length, 1)
      assert.ok(hits[0]!.matchedFields.includes('filename'))
      const paper = search.getPaper(fixture.project, result.paperId)
      assert.equal(paper.title, 'broken') // 标题回退文件名
    } finally {
      indexer.dispose()
      search.dispose()
    }
  })

  it('无提取器（no-extractor）仍可写笔记并搜索', async () => {
    const indexer = new LibraryIndexer({ dataRoot: fixture.dataRoot })
    const search = new LibrarySearch({ dataRoot: fixture.dataRoot })
    try {
      const pdf = writeFakePdf(fixture, 'scanned.pdf')
      const result = await indexer.addPaper(fixture.project, pdf)
      assert.equal(result.extractionStatus, 'no-extractor')
      await indexer.setNotes(fixture.project, result.paperId, '扫描版论文，先记要点')
      const hits = search.search(fixture.project, '扫描版')
      assert.equal(hits.length, 1)
      assert.ok(hits[0]!.matchedFields.includes('notes'))
    } finally {
      indexer.dispose()
      search.dispose()
    }
  })

  it('长 PDF 分页：页级索引、跨页定位与 getTextRange', async () => {
    const extractor: PdfExtractor = async () => {
      const pages: string[] = []
      for (let i = 1; i <= 30; i += 1) {
        pages.push(`Page ${i} content. 第 ${i} 页特征词${i} 与后续正文。`)
      }
      return { pages }
    }
    const indexer = new LibraryIndexer({ dataRoot: fixture.dataRoot, extractor })
    const search = new LibrarySearch({ dataRoot: fixture.dataRoot })
    try {
      const pdf = writeFakePdf(fixture, 'long-paper.pdf')
      const result = await indexer.addPaper(fixture.project, pdf)
      assert.equal(result.extractionStatus, 'ok')
      assert.equal(result.pageCount, 30)
      // 第 17 页可读
      const page17 = search.getPageText(fixture.project, result.paperId, 17)
      assert.ok(page17?.text.includes('第 17 页特征词17'))
      // 跨页检索：命中第 17 页
      const hits = search.search(fixture.project, '特征词17')
      assert.equal(hits.length, 1)
      assert.ok(hits[0]!.locations.some((loc) => loc.page === 17))
      // 原文精确片段
      const text = page17!.text
      const offset = text.indexOf('特征词17')
      const range = search.getTextRange(fixture.project, result.paperId, 17, offset, 3)
      assert.equal(range.text, '特征词')
      // 不存在的页报错
      assert.throws(() => search.getTextRange(fixture.project, result.paperId, 31, 0, 3), /没有第 31 页/)
    } finally {
      indexer.dispose()
      search.dispose()
    }
  })
})

describe('LIB-06 BibTeX 解析/生成/导入', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setup()
  })

  afterEach(() => cleanup(fixture, []))

  it('parseBibtex：跳过 comment、字段抽取、raw 原样保留', () => {
    const text = `% 行注释
@comment{ignore me}
@article{vaswani2017attention,
  title   = {Attention {Is} All You Need},
  author  = {Ashish Vaswani and Noam Shazeer},
  year    = {2017},
  journal = {NeurIPS}
}
@inproceedings{he2016deep,
  title = "Deep Residual Learning for Image Recognition",
  author = {Kaiming He and Xiangyu Zhang and Shaoqing Ren and Jian Sun},
  year = 2016
}`
    const entries = parseBibtex(text)
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.type, 'article')
    assert.equal(entries[0]!.key, 'vaswani2017attention')
    assert.equal(entries[0]!.title, 'Attention Is All You Need') // 嵌套花括号展开
    assert.equal(entries[0]!.author, 'Ashish Vaswani and Noam Shazeer')
    assert.equal(entries[0]!.year, '2017')
    assert.ok(entries[0]!.raw.startsWith('@article{vaswani2017attention'))
    assert.equal(entries[1]!.type, 'inproceedings')
    assert.equal(entries[1]!.title, 'Deep Residual Learning for Image Recognition')
    assert.equal(entries[1]!.year, '2016')
  })

  it('generateBibtex：由元数据生成最小条目', () => {
    const bibtex = generateBibtex({ title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017 })
    assert.ok(bibtex.includes('@article{vaswani17'))
    assert.ok(bibtex.includes('title = {Attention Is All You Need}'))
    assert.ok(bibtex.includes('author = {Ashish Vaswani and Noam Shazeer}'))
    assert.ok(bibtex.includes('year = {2017}'))
  })

  it('importBibtex：按标题挂接、回填元数据、未匹配返回', async () => {
    const indexer = new LibraryIndexer({
      dataRoot: fixture.dataRoot,
      extractor: async () => ({ pages: ['Attention Is All You Need\narXiv:1706.03762'] }),
    })
    const search = new LibrarySearch({ dataRoot: fixture.dataRoot })
    try {
      const pdf = writeFakePdf(fixture, 'attention.pdf')
      const { paperId } = await indexer.addPaper(fixture.project, pdf)
      const result = indexer.importBibtex(
        fixture.project,
        `@article{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Ashish Vaswani and Noam Shazeer and Niki Parmar},
  year = {2017}
}
@article{unknown2020,
  title = {A Paper Not In Library},
  author = {Someone Else},
  year = {2020}
}`,
      )
      assert.equal(result.attached.length, 1)
      assert.equal(result.attached[0]!.paperId, paperId)
      assert.equal(result.unmatched.length, 1)
      assert.equal(result.unmatched[0]!.key, 'unknown2020')
      const paper = search.getPaper(fixture.project, paperId)
      assert.deepEqual(paper.authors, ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar']) // 回填作者
      assert.equal(paper.year, 2017)
      assert.ok(paper.bibtex.includes('@article{vaswani2017attention')) // 原样保存
      assert.equal(indexer.getBibtex(fixture.project, paperId), paper.bibtex)
    } finally {
      indexer.dispose()
      search.dispose()
    }
  })
})

describe('LIB-07 搜索覆盖标题/全文/笔记/references', () => {
  let fixture: Fixture
  let indexer: LibraryIndexer
  let search: LibrarySearch

  beforeEach(() => {
    fixture = setup()
    indexer = new LibraryIndexer({
      dataRoot: fixture.dataRoot,
      extractor: async () => ({ pages: ['Graph Neural Networks 图神经网络方法综述'] }),
    })
    search = new LibrarySearch({ dataRoot: fixture.dataRoot })
  })

  afterEach(() => cleanup(fixture, [indexer, search]))

  it('同一库中标题/全文/笔记/references 四路可命中', async () => {
    const pdfA = writeFakePdf(fixture, 'gnn.pdf')
    const { paperId: aId } = await indexer.addPaper(fixture.project, pdfA)
    await indexer.setNotes(fixture.project, aId, '对比学习与图神经网络结合')
    await indexer.setReferences(fixture.project, aId, ['Hamilton et al.: Inductive Representation Learning on Large Graphs'])
    const pdfB = writeFakePdf(fixture, 'contrastive.pdf')
    await indexer.addPaper(fixture.project, pdfB)

    // 标题/全文（论文 A 标题来自首页启发式）
    let hits = search.search(fixture.project, 'Graph Neural Networks')
    assert.ok(hits.some((h) => h.paper.paperId === aId && h.matchedFields.includes('title')))
    assert.ok(hits.some((h) => h.paper.paperId === aId && h.matchedFields.includes('fulltext')))
    // 笔记
    hits = search.search(fixture.project, '对比学习')
    assert.ok(hits.some((h) => h.paper.paperId === aId && h.matchedFields.includes('notes')))
    // references
    hits = search.search(fixture.project, 'Inductive Representation')
    assert.ok(hits.some((h) => h.paper.paperId === aId && h.matchedFields.includes('references')))
  })
})

describe('LIB-08 图引用数据接口', () => {
  let fixture: Fixture
  let indexer: LibraryIndexer
  let search: LibrarySearch

  beforeEach(() => {
    fixture = setup()
    indexer = new LibraryIndexer({
      dataRoot: fixture.dataRoot,
      extractor: async () => ({ pages: ['正文 1'] }),
    })
    search = new LibrarySearch({ dataRoot: fixture.dataRoot })
  })

  afterEach(() => cleanup(fixture, [indexer, search]))

  it('paperId 与 path 两种 ref 均解析；note ref 携带笔记；无效 ref 返回 undefined', async () => {
    const pdf = writeFakePdf(fixture, 'gnn.pdf')
    const { paperId } = await indexer.addPaper(fixture.project, pdf)
    await indexer.setNotes(fixture.project, paperId, '精读笔记正文')

    const byId = search.resolveRef(fixture.project, { kind: 'paper', paperId })
    assert.equal(byId?.paperId, paperId)
    assert.equal(byId?.kind, 'paper')
    assert.equal(byId?.path, pdf)

    const byPath = search.resolveRef(fixture.project, { kind: 'paper', path: pdf })
    assert.equal(byPath?.paperId, paperId)

    const note = search.resolveRef(fixture.project, { kind: 'note', paperId })
    assert.equal(note?.kind, 'note')
    assert.equal(note?.notes, '精读笔记正文')

    assert.equal(search.resolveRef(fixture.project, { kind: 'paper', paperId: 'nope' }), undefined)

    // 图接线辅助：paper → {kind:'pdf', path}；note 暂无独立文件 → undefined
    assert.deepEqual(search.toGraphRef(fixture.project, { kind: 'paper', paperId }), { kind: 'pdf', path: pdf })
    assert.equal(search.toGraphRef(fixture.project, { kind: 'note', paperId }), undefined)
  })
})

// ── WRITE ───────────────────────────────────────────────────────────────────

describe('WRITE-01/02 稿件目录创建与文件读写', () => {
  let fixture: Fixture
  let manuscript: ManuscriptService

  beforeEach(() => {
    fixture = setup()
    manuscript = new ManuscriptService({ dataRoot: fixture.dataRoot })
  })

  afterEach(() => cleanup(fixture, [manuscript]))

  it('创建最小 paper/ 骨架（main.tex + sections/ + references.bib + figures/）', () => {
    const info = manuscript.createManuscript(fixture.project)
    assert.ok(fs.existsSync(info.mainTex))
    assert.ok(fs.existsSync(info.bib))
    assert.ok(fs.existsSync(info.sectionsDir))
    assert.ok(fs.existsSync(info.figuresDir))
    assert.ok(fs.existsSync(path.join(info.sectionsDir, 'introduction.tex')))
    const files = manuscript.listFiles(fixture.project)
    assert.ok(files.includes('main.tex'))
    assert.ok(files.includes('sections/introduction.tex'))
    assert.ok(files.includes('references.bib'))
    // 幂等
    manuscript.createManuscript(fixture.project)
    assert.equal(manuscript.listManuscripts(fixture.project).length, 1)
  })

  it('readFile/writeFile 往返；路径越界被拒绝', () => {
    manuscript.createManuscript(fixture.project)
    const { path: written } = manuscript.writeFile(fixture.project, undefined, 'sections/methods.tex', '% methods\n\\section{Methods}')
    assert.ok(fs.existsSync(written))
    const { content } = manuscript.readFile(fixture.project, undefined, 'sections/methods.tex')
    assert.equal(content, '% methods\n\\section{Methods}')
    assert.throws(() => manuscript.readFile(fixture.project, undefined, '../secret.txt'), /路径越界/)
    assert.throws(() => manuscript.writeFile(fixture.project, undefined, '..\\..\\evil.tex', 'x'), /路径越界/)
  })

  it('选择已有稿件目录；非稿件目录（缺 main.tex）抛错提示', () => {
    const info = manuscript.createManuscript(fixture.project)
    const again = manuscript.getManuscript(fixture.project, 'paper')
    assert.equal(again.dir, info.dir)
    fs.mkdirSync(path.join(fixture.projectPath, 'not-a-manuscript'), { recursive: true })
    assert.throws(() => manuscript.getManuscript(fixture.project, 'not-a-manuscript'), /缺少 main\.tex/)
  })
})

describe('WRITE-09 实验运行中继续写作（无门禁）', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setup()
  })

  afterEach(() => cleanup(fixture, []))

  it('实验目录存在（运行中）时稿件写入照常', async () => {
    const manuscript = new ManuscriptService({ dataRoot: fixture.dataRoot })
    const indexer = new LibraryIndexer({ dataRoot: fixture.dataRoot })
    try {
      // 实验正在运行：目录与日志存在
      const expDir = path.join(fixture.projectPath, 'experiments', 'exp-1')
      fs.mkdirSync(expDir, { recursive: true })
      fs.writeFileSync(path.join(expDir, 'run.log'), 'epoch 1 loss 0.5\nepoch 2 loss 0.3', 'utf8')

      manuscript.createManuscript(fixture.project)
      // 实验未完成时继续写作（占位或草稿均可）
      manuscript.writeFile(fixture.project, undefined, 'sections/experiments.tex', '% 占位：实验进行中（WRITE-06 无门禁）\n\\section{Experiments}\n待补。')
      const files = manuscript.listFiles(fixture.project)
      assert.ok(files.includes('sections/experiments.tex'))

      // WRITE-05：写作上下文解析（相连实验目录 + 论文）
      const pdf = writeFakePdf(fixture, 'baseline.pdf')
      const { paperId } = await indexer.addPaper(fixture.project, pdf)
      const ctx = manuscript.resolveManuscriptContext(fixture.project, [
        { kind: 'paper', paperId },
        { kind: 'experiment', path: expDir },
        { kind: 'file', path: 'no-such-file.txt' },
        'garbage-ref',
      ])
      assert.equal(ctx.papers.length, 1)
      assert.equal(ctx.papers[0]!.paperId, paperId)
      assert.ok(ctx.files.some((f) => f.path === expDir))
      assert.equal(ctx.unresolved.length, 2) // no-such-file.txt 不存在 + garbage
    } finally {
      manuscript.dispose()
      indexer.dispose()
    }
  })
})

describe('WRITE-03/04 LaTeX 工具探测与编译错误解析', () => {
  let fixture: Fixture
  let originalPath: string | undefined

  beforeEach(() => {
    fixture = setup()
    originalPath = process.env.PATH
  })

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    cleanup(fixture, [])
  })

  it('parseLatexErrors：行内与块式两种模式 + 去重', () => {
    const log = [
      '(./main.tex',
      '! LaTeX Error: File `missing.sty\' not found.',
      'l.12 \\usepackage{missing}',
      '',
      '? ',
      '! Undefined control sequence.',
      'l.45 \\unknowncommand',
      '',
      './sections/methods.tex:7: Misplaced alignment tab character &.',
      'main.tex:12: Undefined control sequence.',
      'main.tex:12: Undefined control sequence.',
    ].join('\n')
    const errors = parseLatexErrors(log)
    const lines = errors.map((e) => `${e.file}:${e.line}:${e.message}`)
    assert.ok(lines.includes('main.tex:12:LaTeX Error: File `missing.sty\' not found.'))
    assert.ok(lines.includes('main.tex:45:Undefined control sequence.'))
    assert.ok(lines.includes('sections/methods.tex:7:Misplaced alignment tab character &.'))
    assert.ok(lines.includes('main.tex:12:Undefined control sequence.'))
    // 去重后同 file:line:message 只出现一次
    assert.equal(errors.filter((e) => e.file === 'main.tex' && e.line === 12 && e.message === 'Undefined control sequence.').length, 1)
  })

  it('PATH 无 LaTeX 工具时 compileManuscript 返回可操作提示（不抛错）', async () => {
    const manuscript = new ManuscriptService({ dataRoot: fixture.dataRoot })
    try {
      manuscript.createManuscript(fixture.project)
      process.env.PATH = path.join(fixture.tmp, 'empty-bin')
      const result = await manuscript.compileManuscript(fixture.project)
      assert.equal(result.ok, false)
      assert.equal(result.tool, null)
      assert.equal(result.logPath, null)
      assert.ok(result.message.includes('未找到 LaTeX 工具'))
      assert.ok(result.message.includes('TeX Live'))
    } finally {
      manuscript.dispose()
    }
  })

  it('findExecutable：PATH 中出现伪工具即可探测到', () => {
    const bin = path.join(fixture.tmp, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'pdflatex.exe'), '', 'utf8')
    process.env.PATH = bin
    assert.equal(findExecutable('pdflatex'), path.join(bin, 'pdflatex.exe'))
    const tools = probeLatexTools()
    assert.equal(tools.pdflatex, path.join(bin, 'pdflatex.exe'))
  })
})

describe('WRITE-07/09 引用核对与草稿对比', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setup()
  })

  afterEach(() => cleanup(fixture, []))

  it('结果完成后核对数字：实验文件定位 + 论文页定位', async () => {
    const manuscript = new ManuscriptService({ dataRoot: fixture.dataRoot })
    const indexer = new LibraryIndexer({
      dataRoot: fixture.dataRoot,
      extractor: async () => ({ pages: ['我们报告 F1=0.93 与 94.2% 准确率。'] }),
    })
    try {
      const expDir = path.join(fixture.projectPath, 'experiments', 'exp-1')
      fs.mkdirSync(expDir, { recursive: true })
      fs.writeFileSync(path.join(expDir, 'results.csv'), 'model,acc\nours,0.93\nbaseline,0.87\n', 'utf8')
      fs.writeFileSync(path.join(expDir, 'run.log'), 'epoch 10: loss 0.05', 'utf8')

      const pdf = writeFakePdf(fixture, 'paper.pdf')
      const { paperId } = await indexer.addPaper(fixture.project, pdf)

      const result = manuscript.quoteCheck(fixture.project, { number: '0.93', experimentDir: expDir, paperId })
      assert.ok(result.paperHits.some((h) => h.paperId === paperId && h.snippet.includes('0.93')))
      const csvHit = result.fileHits.find((h) => h.relative.endsWith('results.csv'))
      assert.ok(csvHit)
      assert.equal(csvHit!.line, 2)
      assert.ok(csvHit!.snippet.includes('0.93'))
      assert.ok(result.message.includes('1 处论文定位'))

      // resultFile 单文件定位
      const single = manuscript.quoteCheck(fixture.project, { text: 'epoch 10', resultFile: path.join(expDir, 'run.log') })
      assert.ok(single.fileHits.some((h) => h.line === 1 && h.snippet.includes('epoch 10')))

      // 查无此数
      const none = manuscript.quoteCheck(fixture.project, { number: '9.99', experimentDir: expDir })
      assert.equal(none.paperHits.length + none.fileHits.length, 0)
      assert.ok(none.message.includes('未找到'))
    } finally {
      manuscript.dispose()
      indexer.dispose()
    }
  })

  it('diffDraft：段落级对比提示可能过期段落，不自动覆盖', () => {
    const oldDraft = [
      '\\section{Intro}',
      '老段落一：实验 A 的结果是 0.91。',
      '',
      '\\section{Method}',
      '不变段落。',
      '',
      '\\section{Related}',
      '将被删除的段落。',
    ].join('\n')
    const newDraft = [
      '\\section{Intro}',
      '老段落一：实验 A 的结果是 0.93（已更新）。',
      '',
      '\\section{Method}',
      '不变段落。',
      '',
      '\\section{Results}',
      '新增段落。',
    ].join('\n')
    const diff = diffDraftTexts(oldDraft, newDraft)
    assert.ok(diff.unchanged.includes('\\section{Method}\n不变段落。'))
    assert.ok(diff.changed.some((c) => c.oldText.includes('0.91') && c.newText.includes('0.93')))
    assert.ok(diff.added.includes('\\section{Results}\n新增段落。'))
    assert.ok(diff.removed.includes('\\section{Related}\n将被删除的段落。'))
    assert.equal(splitParagraphs(oldDraft).length, 3)
  })

  it('diffDraft（服务级）：以当前 main.tex 为基线，绝不写盘', async () => {
    const manuscript = new ManuscriptService({ dataRoot: fixture.dataRoot })
    try {
      manuscript.createManuscript(fixture.project)
      const before = manuscript.readFile(fixture.project, undefined, 'main.tex').content
      const diff = manuscript.diffDraft(fixture.project, undefined, before + '\n\n\\section{New}\n草稿对比不写盘。')
      assert.equal(diff.oldFile.endsWith('main.tex'), true)
      assert.ok(diff.added.some((b) => b.includes('草稿对比不写盘')))
      // 文件未被修改
      assert.equal(manuscript.readFile(fixture.project, undefined, 'main.tex').content, before)
    } finally {
      manuscript.dispose()
    }
  })
})
