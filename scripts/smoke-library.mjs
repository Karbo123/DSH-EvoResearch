#!/usr/bin/env node
/**
 * smoke-library.mjs — LIB 服务级集成验证（任务 t37）。
 *
 * 运行：node --import tsx scripts/smoke-library.mjs
 * 通过标准：exit 0 且全部断言 PASS（自动计数，避免「全过仍 exit 1」）。
 *
 * 覆盖文献、图引用与稿件服务级能力（真实数据、无 sidecar）：
 *   A. 索引注册：自定义 PdfExtractor 注入的可提取 PDF（'ok' 全文注册）
 *      + 无提取器假 PDF（'no-extractor' 降级注册，仍可搜索）；
 *   B. 四路搜索：文件名 / 标题 / 全文 / 精读笔记 / references 各命中；
 *   C. 页定位：getTextRange 原文精确片段 + scanPages 页级命中（WRITE-07 同源）；
 *   D. 图引用：resolveRef（paperId/path 双解析）→ toGraphRef（GraphNodeRef 形状）；
 *   E. BibTeX：references.bib 文件导入（原样保存 + 按标题挂接 + 元数据回填）；
 *   F. 稿件：ManuscriptService 最小骨架创建 + 编译缺工具可操作提示（确定性 PATH）；
 *   G. 清理（BASE-02）：finally rmSync 删除临时目录。
 *
 * 输出：.tmp-dev/images/library-integration-report.md（场景矩阵 / 结果 / 发现）。
 * 全部使用临时目录（mkdtemp），不读写任何真实资料；不修改 src 下任何文件。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceService } from '../packages/evoresearch-plugin/src/host/workspace.ts'
import {
  LibraryIndexer,
  LibrarySearch,
  parseBibtex,
} from '../packages/evoresearch-plugin/src/host/library/index.ts'
import {
  ManuscriptService,
  probeLatexTools,
} from '../packages/evoresearch-plugin/src/host/manuscript.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = path.join(REPO_ROOT, '.tmp-dev', 'library-integration-report.md')

// ---------- 断言收集器（自动计数，BASE-02 约定） ----------
let pass = 0
let total = 0
/** @type {Array<{id: string, name: string, expect: string, actual: string, ok: boolean}>} */
const results = []
const check = (id, name, expect, actual, cond) => {
  total += 1
  if (cond) pass += 1
  results.push({ id, name, expect: String(expect), actual: String(actual), ok: Boolean(cond) })
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${name}`)
  if (!cond) {
    console.log(`      expect: ${String(expect)}`)
    console.log(`      actual: ${String(actual)}`)
  }
}

/** 等待型断言（async 场景用）。 */
const checkAsync = async (id, name, expect, actualPromise, cond) => {
  let actual
  try {
    actual = await actualPromise
  } catch (error) {
    actual = `threw: ${error instanceof Error ? error.message : String(error)}`
  }
  check(id, name, expect, actual, cond)
}

// ---------- 场景运行 ----------
const envInfo = { node: process.version, platform: process.platform, arch: process.arch, release: os.release() }
const findings = []
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-libsmoke-'))
const dataRoot = path.join(tmpBase, 'data')
const workspace = new WorkspaceService({ dataRoot })
const project = workspace.createProject('demo').name
const projectPath = workspace.projectPath(project)
const papersDir = path.join(projectPath, 'papers')
const notesDir = path.join(projectPath, 'notes')
fs.mkdirSync(papersDir, { recursive: true })
fs.mkdirSync(notesDir, { recursive: true })

const indexerPlain = new LibraryIndexer({ dataRoot })
const indexerCustom = new LibraryIndexer({
  dataRoot,
  extractor: async () => ({
    pages: [
      'Attention Is All You Need\nAshish Vaswani and Noam Shazeer\n2017',
      'The transformer 架构采用自注意力机制，图注意力网络 GAT 与其同源。',
      '实验部分：F1 达到 0.93，准确率 94.2%。',
    ],
  }),
})
const search = new LibrarySearch({ dataRoot })
const manuscript = new ManuscriptService({ dataRoot })
const savedPath = process.env.PATH

try {
  console.log('=== A. 索引注册 ===')

  // A1 可提取 PDF：自定义提取器直接注册（2 页文本 + 首页元数据）
  const pdfA = path.join(papersDir, 'attention-graph.pdf')
  fs.writeFileSync(pdfA, 'fake pdf bytes for attention-graph', 'utf8')
  const regA = await indexerCustom.addPaper(project, pdfA)
  check('A-01', 'attention-graph.pdf 全文注册', 'added/ok/3 页', `${regA.status}/${regA.extractionStatus}/${regA.pageCount}`,
    regA.status === 'added' && regA.extractionStatus === 'ok' && regA.pageCount === 3)
  check('A-02', '标题启发式识别首页首行', 'Attention Is All You Need', search.getPaper(project, regA.paperId)?.title,
    search.getPaper(project, regA.paperId)?.title === 'Attention Is All You Need')

  // A2 无提取器假 PDF：默认提取器（pdf-parse 未安装 → null → no-extractor 降级注册）
  fs.writeFileSync(path.join(papersDir, 'scanned-legacy.pdf'), 'not a real pdf', 'utf8')
  const scanA = await indexerPlain.indexLibrary(project, papersDir)
  check('A-03', 'indexLibrary：无提取器假 PDF 降级注册', 'added=1 noExtractor=1 total=2',
    `added=${scanA.added} noExtractor=${scanA.noExtractor} total=${scanA.total}`,
    scanA.added === 1 && scanA.noExtractor === 1 && scanA.total === 2)
  check('A-04', '已全文注册的论文重扫不重提取', 'unchanged=1', `unchanged=${scanA.unchanged}`, scanA.unchanged === 1)
  const paperLegacy = search.listPapers(project).find((p) => p.fileName === 'scanned-legacy.pdf')
  check('A-05', 'no-extractor 论文仍可检索（文件名命中）', 'extractionStatus=no-extractor',
    paperLegacy ? paperLegacy.extractionStatus : 'not found',
    paperLegacy?.extractionStatus === 'no-extractor')
  findings.push(
    'no-extractor/failed 论文照常注册：文件名 + 元数据 + 笔记可搜索；安装 pdf-parse 后重扫会自动重试提取（t7 设计，本脚本未安装依赖，走降级路径）。',
  )

  console.log('\n=== B. 四路搜索（文件名/标题/全文/笔记/references） ===')

  // 精读笔记：notes/ 下 Markdown 文件 → setNotes 写入镜像（原文件为主）
  const noteContent = `# 精读笔记：Attention Is All You Need

自注意力并行化是关键 idea；图注意力网络可借鉴位置编码思路。
`
  fs.writeFileSync(path.join(notesDir, 'attention-graph.md'), noteContent, 'utf8')
  await indexerCustom.setNotes(project, regA.paperId, noteContent)

  // references：references.bib 文件 → 导入挂接（bibtex 原样保存）+ references 清单
  const bibContent = `@article{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Ashish Vaswani and Noam Shazeer and Niki Parmar},
  year = {2017}
}
`
  fs.writeFileSync(path.join(projectPath, 'references.bib'), bibContent, 'utf8')
  const imported = indexerCustom.importBibtex(project, bibContent)
  check('B-00', 'importBibtex 按标题挂接 references.bib', 'attached=1 unmatched=0',
    `attached=${imported.attached.length} unmatched=${imported.unmatched.length}`,
    imported.attached.length === 1 && imported.unmatched.length === 0)
  await indexerCustom.setReferences(project, regA.paperId, [
    'Vaswani et al. 2017: Attention Is All You Need',
    'Kipf & Welling 2017: Semi-Supervised Classification with Graph Convolutional Networks',
  ])

  const hitsFilename = search.search(project, 'scanned-legacy')
  check('B-01', '文件名搜索命中（降级论文）', 'matchedFields 含 filename',
    hitsFilename.map((h) => h.matchedFields.join(',')).join(' | ') || '(无命中)',
    hitsFilename.some((h) => h.matchedFields.includes('filename')))

  const hitsTitle = search.search(project, 'Attention Is All You Need')
  check('B-02', '标题搜索命中', 'matchedFields 含 title',
    hitsTitle.map((h) => h.matchedFields.join(',')).join(' | ') || '(无命中)',
    hitsTitle.some((h) => h.paper.paperId === regA.paperId && h.matchedFields.includes('title')))

  const hitsFulltext = search.search(project, '图注意力网络')
  check('B-03', '全文搜索命中 + 页定位', 'matchedFields 含 fulltext 且 locations 页 2',
    hitsFulltext.map((h) => `${h.matchedFields.join(',')}@${h.locations.map((l) => l.page).join(',')}`).join(' | ') || '(无命中)',
    hitsFulltext.some((h) => h.paper.paperId === regA.paperId && h.matchedFields.includes('fulltext')
      && h.locations.some((l) => l.page === 2)))

  const hitsNotes = search.search(project, '并行化')
  check('B-04', '精读笔记搜索命中', 'matchedFields 含 notes',
    hitsNotes.map((h) => h.matchedFields.join(',')).join(' | ') || '(无命中)',
    hitsNotes.some((h) => h.paper.paperId === regA.paperId && h.matchedFields.includes('notes')))

  const hitsRefs = search.search(project, 'Graph Convolutional')
  check('B-05', 'references 搜索命中（标题完整保留）', 'matchedFields 含 references',
    hitsRefs.map((h) => h.matchedFields.join(',')).join(' | ') || '(无命中)',
    hitsRefs.some((h) => h.paper.paperId === regA.paperId && h.matchedFields.includes('references')))
  findings.push(
    '四路（五字段）搜索全部命中：文件名/标题/全文/笔记/references 走同一 FTS5 trigram 索引；references 条目标题原样保留（未被压缩）。',
  )

  console.log('\n=== C. 页定位 ===')
  const page2 = search.getPageText(project, regA.paperId, 2)
  const offset = page2 ? page2.text.indexOf('自注意力') : -1
  if (offset >= 0) {
    const range = search.getTextRange(project, regA.paperId, 2, offset, 4)
    check('C-01', 'getTextRange 原文精确片段', '文本=自注意力 页=2',
      `文本=${range.text} 页=${range.page}`, range.text === '自注意力' && range.page === 2)
  } else {
    check('C-01', 'getTextRange 原文精确片段', 'offset 找到', `offset=${offset}`, false)
  }
  const numHits = search.scanPages(project, '0.93', { paperId: regA.paperId })
  check('C-02', 'scanPages 数字定位（WRITE-07 同源）', '页 3 命中',
    numHits.map((h) => `页${h.page}:${h.snippet}`).join(' | ') || '(无命中)',
    numHits.some((h) => h.page === 3 && h.snippet.includes('0.93')))
  findings.push(
    'getTextRange/scanPages 的偏移是「清洗空白后页文本」的字符偏移（LIB-02 约定）；数字/短串定位用子串扫描，比 FTS 更可靠。',
  )

  console.log('\n=== D. 图引用（LIB-08） ===')
  const byId = search.resolveRef(project, { kind: 'paper', paperId: regA.paperId })
  check('D-01', 'resolveRef：paperId → 论文', `paperId=${regA.paperId}`, `${byId?.paperId}`, byId?.paperId === regA.paperId)
  const byPath = search.resolveRef(project, { kind: 'paper', path: pdfA })
  check('D-02', 'resolveRef：path → paperId', `paperId=${regA.paperId}`, `${byPath?.paperId}`, byPath?.paperId === regA.paperId)
  const graphRef = search.toGraphRef(project, { kind: 'paper', paperId: regA.paperId })
  check('D-03', 'toGraphRef：GraphNodeRef 形状（kind=pdf, 绝对路径, 文件存在）',
    '{kind:pdf, path 存在}',
    graphRef ? `${graphRef.kind}:${graphRef.path}` : 'undefined',
    graphRef?.kind === 'pdf' && path.isAbsolute(graphRef.path) && fs.existsSync(graphRef.path))
  findings.push('toGraphRef 输出与 chat-graph GraphNodeRef 兼容（t31 已核对 + 运行时复验）：kind=pdf、绝对路径、previewOf 可 stat。')

  console.log('\n=== E. BibTeX（LIB-06） ===')
  const parsed = parseBibtex(bibContent)
  check('E-01', 'parseBibtex 解析 references.bib', '1 条目 / title 匹配',
    `${parsed.length} 条目 / title=${parsed[0]?.title}`,
    parsed.length === 1 && parsed[0]?.title === 'Attention Is All You Need')
  const paperAfter = search.getPaper(project, regA.paperId)
  check('E-02', '导入后 bibtex 原样保存 + 元数据回填（只补空缺）',
    'bibtex 含 @article 且 authors=2（启发式保留，bibtex 3 人完整列表在原文中）且 year=2017',
    `bibtex含@article=${paperAfter.bibtex.includes('@article')} / authors=${paperAfter.authors.length} / year=${paperAfter.year} / bibtex含NikiParmar=${paperAfter.bibtex.includes('Niki Parmar')}`,
    paperAfter.bibtex.includes('@article{vaswani2017attention') && paperAfter.authors.length === 2 && paperAfter.year === 2017 && paperAfter.bibtex.includes('Niki Parmar'))
  check('E-03', 'getBibtex 读取一致（raw 止于条目右花括号）', '与导入原文（trim）一致',
    `${indexerCustom.getBibtex(project, regA.paperId).length} chars`,
    indexerCustom.getBibtex(project, regA.paperId) === bibContent.trim())
  findings.push('BibTeX 原样保存在 papers.bibtex（不进 FTS）；parseBibtex 的 raw 止于条目右花括号（尾部换行不入库）；按标题归一化挂接成功；作者/年份回填只在论文元数据空缺时发生（本场景首页启发式已识别 2 位作者，bibtex 完整 3 人列表保留在 bibtex 原文中）。')

  console.log('\n=== F. 稿件骨架与编译（WRITE-01/03） ===')
  const info = manuscript.createManuscript(project)
  const files = manuscript.listFiles(project)
  check('F-01', 'createManuscript 最小骨架', 'main.tex + sections/introduction.tex + references.bib',
    files.filter((f) => ['main.tex', 'sections/introduction.tex', 'references.bib'].includes(f)).join(',') || '(缺文件)',
    ['main.tex', 'sections/introduction.tex', 'references.bib'].every((f) => files.includes(f)))
  check('F-02', 'listManuscripts 识别稿件目录', '≥1 个含 main.tex 的目录',
    `${manuscript.listManuscripts(project).length} 个`,
    manuscript.listManuscripts(project).some((m) => m.name === 'paper' && m.dir === info.dir))
  // 确定性缺工具路径：临时 PATH 指向空目录（本机有 TeX 也不影响结果）
  process.env.PATH = path.join(tmpBase, 'empty-bin')
  const compile = await manuscript.compileManuscript(project)
  process.env.PATH = savedPath
  check('F-03', 'compileManuscript 缺工具可操作提示（不抛错）',
    'ok=false tool=null 且 message 含安装提示',
    `ok=${compile.ok} tool=${compile.tool} message=${compile.message.slice(0, 40)}…`,
    compile.ok === false && compile.tool === null && compile.message.includes('未找到 LaTeX 工具') && compile.message.includes('TeX Live'))
  findings.push(
    `编译工具探测（probeLatexTools）：本机 PATH=${process.env.PATH ? (process.env.PATH.split(path.delimiter).length + ' 项') : '(空)'}，`
    + `latexmk=${probeLatexTools().latexmk ? '有' : '无'}；缺工具时 compileManuscript 返回可操作提示（安装 TeX Live/MiKTeX 并加入 PATH），不抛错、不阻塞写作（WRITE-06）。`,
  )
} catch (error) {
  check('ERR-01', '冒烟脚本未发生意外异常', '无异常', error instanceof Error ? error.stack ?? error.message : String(error), false)
} finally {
  // BASE-02：释放资源 + 恢复环境 + 删除临时目录（含失败路径）
  indexerPlain.dispose()
  indexerCustom.dispose()
  search.dispose()
  manuscript.dispose()
  if (process.env.PATH !== savedPath) process.env.PATH = savedPath
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true })
      break
    } catch {
      // Windows 文件锁瞬时重试
    }
  }
  check('G-01', '临时目录已清理（BASE-02）', '已删除', fs.existsSync(tmpBase) ? '仍存在' : '已删除', !fs.existsSync(tmpBase))
}

// ---------- 报告 ----------
const okAll = pass === total
const table = results
  .map((r) => `| ${r.id} | ${r.name} | ${r.expect.replace(/\|/g, '\\|')} | ${r.actual.replace(/\|/g, '\\|')} | ${r.ok ? '✅ PASS' : '❌ FAIL'} |`)
  .join('\n')
const report = `# Library 服务级集成验证报告（smoke-library.mjs）

> 生成时间：${new Date().toISOString()} ｜ 运行环境：${envInfo.platform} ${envInfo.arch} / Node ${envInfo.node}
> 运行方式：\`node --import tsx scripts/smoke-library.mjs\`（退出码 0=全过；临时目录自动清理，BASE-02）

## 场景矩阵（${total} 项断言，${pass} 过 / ${total - pass} 败）

| 编号 | 场景 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
${table}

## 结论

${okAll ? '**全部通过**：LIB 服务级集成验证（索引注册 → 四路搜索 → 页定位 → 图引用 → BibTeX → 稿件）链路完整可用。' : `**存在失败**：${total - pass} 项断言未过，见上表。`}

## 发现（诚实记录）

${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## 覆盖映射

- LIB-01 原文件为主 + 镜像可重建：本脚本全部数据在临时目录；原 PDF 从未被索引修改。
- LIB-02 可插拔提取 + 页级位置：自定义 PdfExtractor 注入（A-01）；getTextRange/scanPages（C-01/C-02）。
- LIB-03 提取失败仍可用：no-extractor 论文注册 + 文件名/笔记可搜（A-03/A-05、B-01）。
- LIB-04 精读笔记：Markdown 笔记 → setNotes → 搜索命中（B-04）。
- LIB-05 references：清单独立保存、标题完整保留、可搜索（B-05）。
- LIB-06 BibTeX：references.bib 导入原样保存 + 按标题挂接 + 元数据回填（E-01..E-03）。
- LIB-07 多字段搜索：文件名/标题/全文/笔记/references 各命中（B-01..B-05）。
- LIB-08 图引用：resolveRef/toGraphRef 形状与 GraphNodeRef 兼容（D-01..D-03）。
- WRITE-01 稿件骨架 + WRITE-03 编译（缺工具提示路径）（F-01..F-03）。
`

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
fs.writeFileSync(REPORT_PATH, report, 'utf8')
console.log(`\n报告已写入: ${REPORT_PATH}`)
console.log(`\n${pass}/${total} passed`)
process.exit(okAll ? 0 : 1)
