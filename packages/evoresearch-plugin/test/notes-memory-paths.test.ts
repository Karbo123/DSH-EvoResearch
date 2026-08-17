/**
 * t34：read_memory（memory/tools.ts + read.ts）与 NotesService（notes.ts）路径约定核对。
 *
 * 核对对象：
 * - read_memory 的 memoriesRoot = observationsDirFor(workspace) 去掉尾部 /observations
 *   → <base>/.evoresearch-data/memories；相对路径以它为基准，越界检查为
 *   resolve 后前缀判断（readMemoryFilePaged，RET-07 分页版）；
 * - NotesService 的布局：memories/notes/（新笔记）、memories/RESEARCH_MAP.md、
 *   memories/USER_PROFILE.md 等（背景资料）、memories/observations/（旧 Observation）、
 *   memories/profile/（旧 Identity 文件，memory 成员所有）。
 *
 * 期望结论：两者基准一致（都是 memories 根），notes/ 笔记、RESEARCH_MAP.md、profile
 * 文件全部落在 read_memory 白名单内；../ 逃逸与绝对路径被拒。本测试直接用生产实现
 * （readMemoryFilePaged + NotesService）做等价断言，防止约定漂移。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { TestContext } from 'node:test'
import { NotesService } from '../src/host/notes.js'
import { readMemoryFilePaged, MEMORY_PAGE_CHARS } from '../src/host/memory/read.js'

/** 建立隔离的 dataRoot + 项目目录（用例结束自动清理）。 */
function makeSandbox(t: TestContext): { svc: NotesService; workspace: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-notes-mem-'))
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })
  const dataRoot = path.join(root, 'data')
  const workspace = path.join(dataRoot, 'projects', 'demo')
  fs.mkdirSync(path.join(workspace, '.evoresearch-data', 'memories'), { recursive: true })
  return { svc: new NotesService(dataRoot), workspace }
}

/** 复刻 read_memory 的 memoriesRoot 计算（与 tools.ts 逐字一致）。 */
function memoriesRootOf(svc: NotesService, workspace: string): string {
  return svc.observationsDirOf(workspace).replace(/[\\/]observations$/, '')
}

describe('read_memory 与 NotesService 路径约定（t34）', () => {
  it('基准一致：read_memory 白名单根 == NotesService 的 memories 根；笔记文件落在其内', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const memoriesRoot = memoriesRootOf(svc, workspace)
    // 白名单根必须就是 memories 目录（两个模块共同基准）
    assert.equal(path.basename(memoriesRoot), 'memories')
    const note = svc.createNote({ workspaceDir: workspace, title: '基准核对', body: '正文内容。' })
    // NotesService 产出的笔记必须位于白名单根之下（相对路径 = notes/<file>.md）
    const noteFile = path.join(svc.notesDirOf(workspace), note.fileName)
    assert.ok(path.resolve(noteFile).startsWith(path.resolve(memoriesRoot) + path.sep), '笔记文件在 memories 白名单内')
    assert.equal(path.relative(memoriesRoot, noteFile).split(path.sep).join('/'), `notes/${note.fileName}`)
  })

  it('notes/ 下笔记可经 read_memory 相对路径读取；分页语义与 notes-read 一致（新笔记零 frontmatter）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const body = '第一段。\n\n' + 'x'.repeat(9000) + '\n\n结尾段。'
    const note = svc.createNote({ workspaceDir: workspace, title: '长笔记', body })
    const memoriesRoot = memoriesRootOf(svc, workspace)
    // read_memory 第一页（默认 6000）
    const page1 = readMemoryFilePaged(memoriesRoot, `notes/${note.fileName}`)
    assert.ok(!('error' in page1), 'notes/ 下笔记可读')
    if ('error' in page1) return
    assert.equal(page1.content.length, MEMORY_PAGE_CHARS)
    assert.equal(page1.hasMore, true)
    assert.equal(page1.totalChars, note.body.length)
    // 与 NotesService.readNote 第一页完全一致（新笔记无 frontmatter，偏移基准相同）
    const servicePage1 = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: 0, limit: MEMORY_PAGE_CHARS })
    assert.equal(page1.content, servicePage1.body)
    // 翻页拼接 == 原始文件全文（RET-07 语义）
    let assembled = page1.content
    let offset = page1.offset + page1.limit
    for (let guard = 0; guard < 10; guard += 1) {
      const page = readMemoryFilePaged(memoriesRoot, `notes/${note.fileName}`, offset, MEMORY_PAGE_CHARS)
      if ('error' in page) break
      assembled += page.content
      if (!page.hasMore) break
      offset = page.offset + page.limit
    }
    assert.equal(assembled, fs.readFileSync(path.join(svc.notesDirOf(workspace), note.fileName), 'utf8'))
  })

  it('RESEARCH_MAP.md 与 USER_PROFILE.md 可经 read_memory 读取（相对路径=裸文件名）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap', content: '# 最近在做什么\n\n检索方向在推进。' })
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'userProfile', content: '称呼：研究员。' })
    const memoriesRoot = memoriesRootOf(svc, workspace)
    const map = readMemoryFilePaged(memoriesRoot, 'RESEARCH_MAP.md')
    assert.ok(!('error' in map), 'RESEARCH_MAP.md 可读')
    if (!('error' in map)) assert.equal(map.content, '# 最近在做什么\n\n检索方向在推进。')
    const profile = readMemoryFilePaged(memoriesRoot, 'USER_PROFILE.md')
    assert.ok(!('error' in profile), 'USER_PROFILE.md 可读')
    if (!('error' in profile)) assert.equal(profile.content, '称呼：研究员。')
  })

  it('旧 observations/ 与 profile/ 目录仍可读（read_memory 返回原始文件内容，含 frontmatter）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const obsDir = path.join(svc.observationsDirOf(workspace), 'global')
    fs.mkdirSync(obsDir, { recursive: true })
    fs.writeFileSync(path.join(obsDir, 'O-legacy.md'), '---\ntitle: 旧观测\n---\n\n旧正文。', 'utf8')
    const profileDir = path.join(memoriesRootOf(svc, workspace), 'profile')
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(path.join(profileDir, 'SOUL.md'), '# SOUL\n\n研究者设定。', 'utf8')
    const memoriesRoot = memoriesRootOf(svc, workspace)
    const obs = readMemoryFilePaged(memoriesRoot, 'observations/global/O-legacy.md')
    assert.ok(!('error' in obs), '旧 Observation 可读')
    if (!('error' in obs)) assert.ok(obs.content.startsWith('---'), '原始内容含 frontmatter（read_memory 不做解析）')
    const soul = readMemoryFilePaged(memoriesRoot, 'profile/SOUL.md')
    assert.ok(!('error' in soul), 'profile/SOUL.md 可读')
    if (!('error' in soul)) assert.equal(soul.content, '# SOUL\n\n研究者设定。')
  })

  it('越界路径被拒绝：../ 逃逸、绝对路径、目录、不存在文件', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.createNote({ workspaceDir: workspace, title: '笔记', body: '正文。' })
    const memoriesRoot = memoriesRootOf(svc, workspace)
    const reject = (rel: string, why: string) => {
      const result = readMemoryFilePaged(memoriesRoot, rel)
      assert.ok('error' in result, `${why}（${rel}）必须被拒绝`)
    }
    reject('../escape.md', '父目录逃逸')
    reject('..\\..\\..\\outside.txt', '多级逃逸（反斜杠）')
    reject('notes/../../outside.md', '路径中间逃逸')
    reject(path.resolve(memoriesRoot, '..', 'project-secret.md'), '绝对路径（memories 外）')
    reject(path.join(os.tmpdir(), 'unrelated', 'x.md'), '无关临时目录绝对路径')
    reject('notes', '目录本身（isDirectory 拒绝）')
    reject('notes/不存在.md', '不存在的文件')
    // 越界错误信息与工具描述一致
    const esc = readMemoryFilePaged(memoriesRoot, '../x.md')
    assert.ok('error' in esc && esc.error.includes('路径越界'))
  })

  it('notes-read 与 read_memory 的偏移基准差异仅在旧文件（frontmatter）：新笔记一致、旧文件 read_memory 含原始头', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, title: '无标题差异笔记', body: '新笔记正文。' })
    const memoriesRoot = memoriesRootOf(svc, workspace)
    const viaTool = readMemoryFilePaged(memoriesRoot, `notes/${note.fileName}`, 0, 100)
    const viaService = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: 0, limit: 100 })
    if (!('error' in viaTool)) {
      assert.equal(viaTool.content, viaService.body, '新笔记：两种读取偏移基准一致')
    }
    // 旧文件：read_memory 返回原始内容（含 frontmatter），notes-read 返回解析后正文——行为差异需文档化
    const obsDir = path.join(svc.observationsDirOf(workspace), 'global')
    fs.mkdirSync(obsDir, { recursive: true })
    fs.writeFileSync(path.join(obsDir, 'O-diff.md'), '---\ntitle: 旧\n---\n\n旧正文。', 'utf8')
    const obsTool = readMemoryFilePaged(memoriesRoot, 'observations/global/O-diff.md', 0, 100)
    const obsService = svc.readNote({ workspaceDir: workspace, noteId: 'O-diff', offset: 0, limit: 100 })
    if (!('error' in obsTool)) {
      assert.ok(obsTool.content.startsWith('---'))
      assert.equal(obsService.body, '旧正文。')
    }
  })
})
