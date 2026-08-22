/**
 * 文献工具组（P2-2）测试：search_library / search_literature / import_literature。
 *
 * 覆盖：
 * - search_library：空库、假 PDF 入库后按标题/文件名命中、项目外会话报错；
 * - search_literature：无 web_search 时仅本地 + note 提示；有 web_search 时
 *   网络结果合并；单条网络失败降级为 web_error（绝不抛错）；
 * - import_literature：PDF 下载落盘并入库、HTML/魔数失败明确报错、HTTP 失败、
 *   非法 URL、同名文件 -2 后缀。
 *
 * 测试隔离（BASE-02）：mkdtemp 临时数据根 + t.after 清理，不碰真实数据根。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { LibraryIndexer, LibrarySearch } from '../src/host/library/index.js'
import { registerLibraryTools, type LibraryToolsDeps } from '../src/host/library/tools.js'

/** Windows 下删除临时目录（SQLite 句柄释放有延迟，重试几次）。 */
function rmRfRetry(dir: string): void {
  for (let i = 0; i < 8; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Windows 文件锁瞬时重试
    }
  }
}

/** 构造一个最小 fetch Response 替身。 */
function fakeResponse(options: { ok?: boolean; status?: number; contentType?: string; body?: string }): Response {
  const bytes = new TextEncoder().encode(options.body ?? '')
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? (options.contentType ?? '') : null),
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response
}

/** 工具执行上下文替身：只带 agent.session.header.cwd。 */
function execFor(cwd: string): ToolRunContext {
  return { agent: { session: { header: { cwd } } } } as unknown as ToolRunContext
}

interface Harness {
  tmp: string
  dataRoot: string
  projectPath: string
  indexer: LibraryIndexer
  search: LibrarySearch
  captured: Record<string, ToolDefinition>
  dispose: () => void
}

/** 搭建临时数据根 + 真实 Library 服务 + fake ctx 工具捕获。 */
function setup(t: { after(cleanup: () => void): void }, depsOverride: Partial<LibraryToolsDeps> = {}): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-libtools-'))
  const dataRoot = path.join(tmp, 'data')
  const projectPath = path.join(dataRoot, 'projects', 'demo')
  fs.mkdirSync(projectPath, { recursive: true })
  const indexer = new LibraryIndexer({ dataRoot })
  const search = new LibrarySearch({ dataRoot })
  t.after(() => {
    indexer.dispose()
    search.dispose()
    rmRfRetry(tmp)
  })
  const captured: Record<string, ToolDefinition> = {}
  const ctx = {
    get: (name: string) =>
      name === 'tools'
        ? { register: (def: ToolDefinition) => { captured[def.name] = def; return () => {} } }
        : undefined,
  } as unknown as Context
  const deps: LibraryToolsDeps = {
    dataRoot,
    librarySearch: search,
    libraryIndexer: indexer,
    hasWebSearch: () => false,
    invokeWebSearch: async () => '',
    ...depsOverride,
  }
  const dispose = registerLibraryTools(ctx, deps)
  return { tmp, dataRoot, projectPath, indexer, search, captured, dispose }
}

// ── search_library ──────────────────────────────────────────────────────────

describe('search_library', () => {
  it('空库返回空 hits；项目外会话返回定位错误', async (t) => {
    const h = setup(t)
    const empty = (await h.captured['search_library']!.execute({ query: 'anything' }, execFor(h.projectPath))) as { project: string; hits: unknown[] }
    assert.equal(empty.project, 'demo')
    assert.deepEqual(empty.hits, [])

    const outside = (await h.captured['search_library']!.execute(
      { query: 'x' },
      execFor(path.join(os.tmpdir(), 'definitely-not-a-project')),
    )) as { error: string }
    assert.ok(outside.error.includes('当前会话不在科研项目内'))
  })

  it('假 PDF 入库后按文件名/标题可命中（wire 字段 snake_case）', async (t) => {
    const h = setup(t)
    const pdfDir = path.join(h.projectPath, 'papers')
    fs.mkdirSync(pdfDir, { recursive: true })
    const pdf = path.join(pdfDir, 'attention-is-all-you-need.pdf')
    fs.writeFileSync(pdf, '%PDF-1.4 fake', 'utf8')
    await h.indexer.addPaper('demo', pdf)

    const out = (await h.captured['search_library']!.execute({ query: 'attention' }, execFor(h.projectPath))) as {
      project: string
      hits: Array<Record<string, unknown>>
    }
    assert.equal(out.project, 'demo')
    assert.equal(out.hits.length, 1)
    const hit = out.hits[0]!
    assert.equal(hit.file_name, 'attention-is-all-you-need.pdf')
    assert.equal(hit.title, 'attention is all you need') // 无提取器时标题回退文件名猜测
    assert.equal(typeof hit.score, 'number')
    assert.ok(Array.isArray(hit.matched_fields))
    assert.ok((hit.matched_fields as string[]).includes('filename'))
  })
})

// ── search_literature ───────────────────────────────────────────────────────

describe('search_literature', () => {
  it('hasWebSearch=false：仅本地结果，note 提示未配置网络检索', async (t) => {
    const h = setup(t)
    const out = (await h.captured['search_literature']!.execute(
      { queries: ['attention', 'transformer'] },
      execFor(h.projectPath),
    )) as { local_hits: unknown[]; web_results: unknown[]; note: string }
    assert.deepEqual(out.local_hits, [])
    assert.deepEqual(out.web_results, [])
    assert.ok(out.note.includes('未配置网络检索'))
  })

  it('hasWebSearch=true：网络查询结果合并进 web_results', async (t) => {
    const h = setup(t, { hasWebSearch: () => true, invokeWebSearch: async (q) => `web hit for ${q}` })
    const out = (await h.captured['search_literature']!.execute(
      { queries: ['graph neural networks'] },
      execFor(h.projectPath),
    )) as { web_results: Array<{ kind: string; query: string; excerpt: string }> }
    assert.equal(out.web_results.length, 1)
    assert.equal(out.web_results[0]!.kind, 'web')
    assert.equal(out.web_results[0]!.query, 'graph neural networks')
    assert.equal(out.web_results[0]!.excerpt, 'web hit for graph neural networks')
  })

  it('单条网络失败降级为 web_error，绝不抛错', async (t) => {
    const h = setup(t, {
      hasWebSearch: () => true,
      invokeWebSearch: async (q) => {
        if (q === 'bad') throw new Error('rate limited')
        return `ok ${q}`
      },
    })
    const out = (await h.captured['search_literature']!.execute(
      { queries: ['good', 'bad'] },
      execFor(h.projectPath),
    )) as { web_results: Array<{ kind: string; error?: string }> }
    assert.equal(out.web_results.length, 2)
    assert.equal(out.web_results[0]!.kind, 'web')
    assert.equal(out.web_results[1]!.kind, 'web_error')
    assert.ok(out.web_results[1]!.error?.includes('rate limited'))
  })

  it('queries 为空返回参数错误', async (t) => {
    const h = setup(t)
    const out = (await h.captured['search_literature']!.execute({ queries: [] }, execFor(h.projectPath))) as { error: string }
    assert.ok(out.error.includes('queries'))
  })
})

// ── import_literature ───────────────────────────────────────────────────────

describe('import_literature', () => {
  it('PDF 下载落盘并入库（libraryList 可见）；同名再导入加 -2 后缀', async (t) => {
    const h = setup(t, { fetchImpl: async () => fakeResponse({ contentType: 'application/pdf', body: '%PDF-1.4 mock pdf bytes' }) })
    const url = 'https://example.org/papers/download?id=1'
    const first = (await h.captured['import_literature']!.execute(
      { url, title: 'Attention Is All You Need' },
      execFor(h.projectPath),
    )) as { ok: boolean; paper_id: string; file_path: string; extraction_status: string; title: string }
    assert.equal(first.ok, true)
    assert.equal(typeof first.paper_id, 'string')
    assert.ok(fs.existsSync(first.file_path))
    assert.ok(first.file_path.includes(path.join('projects', 'demo', 'library-papers')))
    assert.ok(first.file_path.endsWith('attention-is-all-you-need.pdf'))

    // 同名第二次导入 → -2 后缀，两篇都在库中
    const second = (await h.captured['import_literature']!.execute({ url, title: 'Attention Is All You Need' }, execFor(h.projectPath))) as {
      ok: boolean
      file_path: string
    }
    assert.equal(second.ok, true)
    assert.notEqual(second.file_path, first.file_path)
    assert.ok(second.file_path.endsWith('attention-is-all-you-need-2.pdf'))
    assert.equal(h.search.listPapers('demo').length, 2)
  })

  it('HTML 响应（content-type text/html）明确报错不伪造导入', async (t) => {
    const h = setup(t, { fetchImpl: async () => fakeResponse({ contentType: 'text/html', body: '<html>paywall</html>' }) })
    const out = (await h.captured['import_literature']!.execute(
      { url: 'https://example.org/paper/123' },
      execFor(h.projectPath),
    )) as { ok: boolean; error: string }
    assert.equal(out.ok, false)
    assert.ok(out.error.includes('付费墙'))
    assert.equal(h.search.listPapers('demo').length, 0)
  })

  it('content-type 是 PDF 但魔数不符（付费墙页）明确报错', async (t) => {
    const h = setup(t, { fetchImpl: async () => fakeResponse({ contentType: 'application/pdf', body: '<html>captcha</html>' }) })
    const out = (await h.captured['import_literature']!.execute(
      { url: 'https://example.org/paper/456' },
      execFor(h.projectPath),
    )) as { ok: boolean; error: string }
    assert.equal(out.ok, false)
    assert.ok(out.error.includes('不是有效 PDF'))
  })

  it('HTTP 非 2xx 明确报错', async (t) => {
    const h = setup(t, { fetchImpl: async () => fakeResponse({ ok: false, status: 404 }) })
    const out = (await h.captured['import_literature']!.execute(
      { url: 'https://example.org/missing.pdf' },
      execFor(h.projectPath),
    )) as { ok: boolean; error: string }
    assert.equal(out.ok, false)
    assert.equal(out.error, 'HTTP 404')
  })

  it('非法 URL 与非 http(s) 协议拒绝', async (t) => {
    const h = setup(t)
    const bad = (await h.captured['import_literature']!.execute({ url: 'not-a-url' }, execFor(h.projectPath))) as { ok: boolean }
    assert.equal(bad.ok, false)
    const ftp = (await h.captured['import_literature']!.execute({ url: 'ftp://example.org/a.pdf' }, execFor(h.projectPath))) as {
      ok: boolean
      error: string
    }
    assert.equal(ftp.ok, false)
    assert.ok(ftp.error.includes('http'))
  })
})
