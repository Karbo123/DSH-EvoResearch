/**
 * NOTE-01..09：NotesService（自由文本研究笔记）单元测试正式化。
 *
 * 覆盖（与 api-integration-notes.md / t3 冒烟脚本对齐）：
 * 1. 零 frontmatter 笔记：创建（标题可选/正文必需）/列表/读取/编辑（正文优先）/删除；
 * 2. 旧 Observation 兼容：frontmatter 解析、正文读写时 header 字节保留、hasFrontmatter 标记；
 * 3. 段落索引：自然段偏移定位、增量重建（mtime+size 指纹）、索引删除自愈、命中返回正确 noteId+offset；
 * 4. 分页读取：长笔记 offset/nextOffset 翻页、nextOffset=null 结尾；
 * 5. 草稿两段式：updateDraft→预览→applyDraft、baseHash 冲突拒绝、force 覆盖、discard；
 * 6. 背景资料：USER_PROFILE/RESEARCH_TASTE/PROJECT_PROFILE/RESEARCH_MAP 缺失空读、写入读回一致。
 *
 * 测试卫生（BASE-02 / t25 约定）：全部临时目录 os.tmpdir()+mkdtemp+after 清理。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { NotesService } from '../src/host/notes.js'
import type { TestContext } from 'node:test'

/** 建立隔离的 dataRoot + 项目目录（用例结束自动清理）。 */
function makeSandbox(t: TestContext): { svc: NotesService; dataRoot: string; workspace: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-notes-'))
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })
  const dataRoot = path.join(root, 'data')
  const workspace = path.join(dataRoot, 'projects', 'demo')
  fs.mkdirSync(path.join(workspace, '.evoresearch-data', 'memories'), { recursive: true })
  return { svc: new NotesService(dataRoot), dataRoot, workspace }
}

/** 手写一个旧 Observation 文件（observations/global/）。 */
function writeLegacyObservation(svc: NotesService, workspace: string, fileName: string, content: string): string {
  const dir = path.join(svc.observationsDirOf(workspace), 'global')
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, fileName)
  fs.writeFileSync(full, content, 'utf8')
  return full
}

// ── 1. 零 frontmatter 笔记 CRUD（NOTE-01/02/06）─────────────────────────────

describe('NOTE-01/02：零 frontmatter 笔记创建', () => {
  it('无标题创建：正文必需、零 frontmatter、标题回退首个非空行、文件名 slug+短id', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, body: '一段随手记下的灵感。\n\n第二段：还没有验证的猜想。' })
    const raw = fs.readFileSync(path.join(svc.notesDirOf(workspace), note.fileName), 'utf8')
    assert.ok(!raw.startsWith('---'), '新笔记必须零 frontmatter')
    assert.equal(note.title, '一段随手记下的灵感。')
    assert.match(note.fileName, /^[a-z0-9-]+-[0-9a-f]{8}\.md$/)
    assert.equal(note.noteId, note.fileName.slice(0, -3))
    assert.equal(note.source, 'note')
    assert.equal(note.hasFrontmatter, false)
    assert.equal(note.body, '一段随手记下的灵感。\n\n第二段：还没有验证的猜想。')
  })

  it('有标题创建：标题写成正文首行 H1，仍零 frontmatter', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, title: '方法比较：混合检索 vs 事件图', body: '比较两者的召回质量。' })
    const raw = fs.readFileSync(path.join(svc.notesDirOf(workspace), note.fileName), 'utf8')
    assert.ok(raw.startsWith('# 方法比较：混合检索 vs 事件图'))
    assert.ok(!raw.startsWith('---'))
  })

  it('正文为空抛错（正文必需）；同名标题文件名不冲突', (t) => {
    const { svc, workspace } = makeSandbox(t)
    assert.throws(() => svc.createNote({ workspaceDir: workspace, body: '   ' }))
    const a = svc.createNote({ workspaceDir: workspace, title: '同一个标题', body: '第一份。' })
    const b = svc.createNote({ workspaceDir: workspace, title: '同一个标题', body: '第二份。' })
    assert.notEqual(a.fileName, b.fileName)
  })
})

describe('NOTE-01/06：列表 / 读取 / 编辑 / 删除', () => {
  it('列表返回标题+预览+元信息，最新优先', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const older = svc.createNote({ workspaceDir: workspace, title: '较早的笔记', body: '旧正文。' })
    const newer = svc.createNote({ workspaceDir: workspace, title: '较新的笔记', body: '新正文。' })
    // 触碰较早笔记 → 它成为最新
    svc.writeNote({ workspaceDir: workspace, noteId: older.noteId, body: '更新过的旧笔记。' })
    const list = svc.listNotes({ workspaceDir: workspace })
    assert.equal(list.length, 2)
    assert.equal(list[0]?.noteId, older.noteId, '最新优先')
    assert.equal(list[0]?.title, '更新过的旧笔记。', '标题 = 正文首个非空行（正文优先）')
    assert.ok(list[0]?.bodyPreview.includes('更新过的旧笔记'))
    assert.ok(list.find((n) => n.noteId === newer.noteId) !== undefined)
  })

  it('读取正文与写入一致；编辑后正文原样落盘且不产生 frontmatter（正文优先）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, title: '可编辑笔记', body: '第一版正文。' })
    const read = svc.readNote({ workspaceDir: workspace, noteId: note.noteId })
    assert.equal(read.body, '# 可编辑笔记\n\n第一版正文。', '有标题时正文含首行 H1')
    assert.equal(read.hasFrontmatter, false)
    assert.equal(read.nextOffset, null)
    const updated = svc.writeNote({ workspaceDir: workspace, noteId: note.noteId, body: '用户直接改写：第二版。\n第二行。' })
    const raw = fs.readFileSync(path.join(svc.notesDirOf(workspace), note.fileName), 'utf8')
    assert.equal(raw, '用户直接改写：第二版。\n第二行。', '正文按原样落盘')
    assert.ok(!raw.startsWith('---'))
    assert.equal(updated.body, '用户直接改写：第二版。\n第二行。')
    assert.equal(svc.readNote({ workspaceDir: workspace, noteId: note.noteId }).body, '用户直接改写：第二版。\n第二行。')
  })

  it('编辑后标题随正文首行变化（标题=正文 H1，无独立元数据）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, title: '旧标题', body: '正文。' })
    svc.writeNote({ workspaceDir: workspace, noteId: note.noteId, body: '# 新标题\n\n正文。' })
    assert.equal(svc.readNote({ workspaceDir: workspace, noteId: note.noteId }).title, '新标题')
  })

  it('删除：文件消失、列表不含、再读抛错', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, title: '待删除', body: '内容。' })
    assert.equal(svc.deleteNote({ workspaceDir: workspace, noteId: note.noteId }).ok, true)
    assert.ok(!fs.existsSync(path.join(svc.notesDirOf(workspace), note.fileName)))
    assert.ok(!svc.listNotes({ workspaceDir: workspace }).some((n) => n.noteId === note.noteId))
    assert.throws(() => svc.readNote({ workspaceDir: workspace, noteId: note.noteId }))
  })

  it('非法 noteId 被路径护栏拒绝', (t) => {
    const { svc, workspace } = makeSandbox(t)
    assert.throws(() => svc.readNote({ workspaceDir: workspace, noteId: '../escape' }))
    assert.throws(() => svc.readNote({ workspaceDir: workspace, noteId: '' }))
  })
})

// ── 2. 旧 Observation 兼容（NOTE-03/04 / §12.3）──────────────────────────────

describe('NOTE-03/04：旧 Observation 兼容', () => {
  it('列表识别旧文件：hasFrontmatter 标记、frontmatter 标题、legacyDir；兼容别名只列旧', (t) => {
    const { svc, workspace } = makeSandbox(t)
    writeLegacyObservation(
      svc, workspace, 'O-legacy01.md',
      '---\ntitle: 旧观测\ncategories: ["idea"]\nstatus: active\n---\n\n旧系统沉淀的长期事实。',
    )
    const list = svc.listNotes({ workspaceDir: workspace })
    const legacy = list.find((n) => n.fileName === 'O-legacy01.md')
    assert.ok(legacy !== undefined, '旧 Observation 出现在列表')
    assert.equal(legacy?.source, 'observation')
    assert.equal(legacy?.hasFrontmatter, true)
    assert.equal(legacy?.title, '旧观测', '标题来自 frontmatter')
    assert.equal(legacy?.legacyDir, 'global')
    const onlyLegacy = svc.listLegacyObservations(workspace)
    assert.equal(onlyLegacy.length, 1)
    assert.equal(onlyLegacy[0]?.fileName, 'O-legacy01.md')
  })

  it('读取：正文不含 frontmatter；frontmatter 独立字段返回（UI 默认折叠）；projects/<P-id>/ 子目录可读', (t) => {
    const { svc, workspace } = makeSandbox(t)
    writeLegacyObservation(
      svc, workspace, 'O-proj01.md',
      '---\ntitle: 项目观测\ncategories: ["idea", "method"]\nstatus: active\n---\n\n项目级旧事实。',
    )
    const projDir = path.join(svc.observationsDirOf(workspace), 'projects', 'P-1')
    fs.mkdirSync(projDir, { recursive: true })
    fs.writeFileSync(path.join(projDir, 'O-sub01.md'), '---\ntitle: 子目录观测\n---\n\n子目录正文。', 'utf8')
    const read = svc.readNote({ workspaceDir: workspace, noteId: 'O-proj01' })
    assert.equal(read.body, '项目级旧事实。')
    assert.equal(read.hasFrontmatter, true)
    assert.deepEqual(read.frontmatter?.['categories'], ['idea', 'method'])
    assert.equal(read.frontmatter?.['title'], '项目观测')
    const sub = svc.readNote({ workspaceDir: workspace, noteId: 'O-sub01' })
    assert.equal(sub.body, '子目录正文。')
    assert.equal(sub.legacyDir, 'projects/P-1')
  })

  it('编辑旧文件：header 字节级保留，只替换 frontmatter 之后的正文', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const original = '---\ntitle: "旧 观测"\nnote: 含 : 冒号与 # 井号的行\ncategories: ["idea", "method"]\nstatus: active\n---\n\n旧正文第一段。\n旧正文第二段。'
    const full = writeLegacyObservation(svc, workspace, 'O-keep.md', original)
    const header = original.slice(0, original.indexOf('旧正文第一段。'))
    const updated = svc.writeNote({ workspaceDir: workspace, noteId: 'O-keep', body: '用户改写后的正文。' })
    assert.equal(fs.readFileSync(full, 'utf8'), `${header}用户改写后的正文。`, 'header 逐字节保留')
    assert.equal(updated.hasFrontmatter, true)
    assert.equal(updated.body, '用户改写后的正文。')
  })
})

// ── 3. 段落索引（NOTE-05）───────────────────────────────────────────────────

describe('NOTE-05：段落索引与检索', () => {
  it('按自然段索引：命中返回正确 noteId/paragraphIndex/offset（可精确定位）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const body = Array.from({ length: 12 }, (_, i) => `段落 ${i}：关于检索方向的第 ${i} 段内容。`).join('\n\n')
    const note = svc.createNote({ workspaceDir: workspace, title: '长笔记', body })
    // 正文首行是 H1「# 长笔记」（占 5 字符 + 2 换行 → 段落 1 偏移 7）
    const hits = svc.searchIndex({ workspaceDir: workspace, query: '检索方向', limit: 100 })
    assert.equal(hits.length, 12, '12 个自然段全部命中')
    assert.ok(hits.every((h) => h.noteId === note.noteId))
    const first = hits.find((h) => h.paragraphIndex === 1)
    assert.equal(first?.offset, 7, '段落 1 起始偏移 = 7')
    assert.ok(first?.snippet.includes('段落 0'))
    // 无关词零命中
    assert.equal(svc.searchIndex({ workspaceDir: workspace, query: '绝不存在的关键词xyz' }).length, 0)
  })

  it('增量重建：mtime+size 指纹，外部编辑后只重建受影响文件', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const a = svc.createNote({ workspaceDir: workspace, title: '笔记A', body: 'A 的内容。' })
    const b = svc.createNote({ workspaceDir: workspace, title: '笔记B', body: 'B 的内容。' })
    assert.equal(svc.refreshIndex(workspace).changed, 0, '创建即建索引，无变化不重建')
    fs.appendFileSync(path.join(svc.notesDirOf(workspace), a.fileName), '\n\nA 的外部追加。')
    const result = svc.refreshIndex(workspace)
    assert.equal(result.changed, 1, '只重建被编辑的文件')
    // 编辑立即可检索（正文优先，NOTE-06）
    const hits = svc.searchIndex({ workspaceDir: workspace, query: '外部追加' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.noteId, a.noteId)
  })

  it('索引删除自愈：clearIndex 后检索自动重建（索引不是唯一副本）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.createNote({ workspaceDir: workspace, title: '自愈笔记', body: '包含 独特关键词 的正文。' })
    assert.equal(svc.clearIndex({ workspaceDir: workspace }).ok, true)
    const hits = svc.searchIndex({ workspaceDir: workspace, query: '独特关键词' })
    assert.equal(hits.length, 1, '删除索引后检索仍可用（自动重建）')
  })

  it('rebuildIndex：全量/按 noteIds 局部重建，计数正确', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const a = svc.createNote({ workspaceDir: workspace, title: '甲', body: '甲正文。' })
    const b = svc.createNote({ workspaceDir: workspace, title: '乙', body: '乙正文。' })
    const partial = svc.rebuildIndex({ workspaceDir: workspace, noteIds: [a.noteId] })
    assert.equal(partial.indexed, 1)
    const full = svc.rebuildIndex({ workspaceDir: workspace })
    assert.equal(full.indexed, 2)
  })
})

// ── 4. 分页读取（NOTE-05）───────────────────────────────────────────────────

describe('NOTE-05：长笔记范围分页', () => {
  it('offset/nextOffset 翻页：首尾衔接，读到结尾 nextOffset=null', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const body = '段落 0：开头。\n\n' + 'x'.repeat(150) + '\n\n段落 2：结尾。'
    const note = svc.createNote({ workspaceDir: workspace, body })
    const page1 = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: 0, limit: 60 })
    assert.equal(page1.body.length, 60)
    assert.equal(page1.nextOffset, 60, '第一页 nextOffset = 60')
    assert.equal(page1.totalLength, body.length)
    const page2 = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: 60, limit: 60 })
    assert.equal(page2.offset, 60)
    assert.equal(page2.nextOffset, 120)
    const end = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: body.length - 10, limit: 100 })
    assert.equal(end.body.length, 10, '末页只剩 10 字符')
    assert.equal(end.nextOffset, null, '读到结尾 nextOffset=null')
  })

  it('limit 缺省返回全文；offset 为负按 0 处理', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const note = svc.createNote({ workspaceDir: workspace, body: '全文内容。' })
    const whole = svc.readNote({ workspaceDir: workspace, noteId: note.noteId })
    assert.equal(whole.body, '全文内容。')
    assert.equal(whole.nextOffset, null)
    const clamped = svc.readNote({ workspaceDir: workspace, noteId: note.noteId, offset: -5, limit: 3 })
    assert.equal(clamped.offset, 0)
    assert.equal(clamped.body, '全文内')
  })
})

// ── 5. 草稿两段式（NOTE-08）─────────────────────────────────────────────────

describe('NOTE-08：草稿 → 用户确认（不静默整体覆盖）', () => {
  it('updateDraft 只落盘草稿不改目标；listDrafts/readDraft 可预览；applyDraft 成功', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap', content: '# 最近在做什么\n\n当前原文。' })
    const before = svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' }).content
    const draft = svc.updateDraft({
      workspaceDir: workspace,
      kind: 'researchMap',
      draft: '# 最近在做什么\n\nAI 提议的新内容。',
      note: 'AI 提议重写',
    })
    assert.equal(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' }).content, before, '草稿创建不改目标')
    const listed = svc.listDrafts({ workspaceDir: workspace })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.fileName, 'RESEARCH_MAP.md')
    assert.equal(listed[0]?.note, 'AI 提议重写')
    assert.equal(listed[0]?.targetExisted, true)
    const preview = svc.readDraft({ workspaceDir: workspace, draftId: draft.draftId })
    assert.ok(preview.draft.includes('AI 提议的新内容'))
    const applied = svc.applyDraft({ workspaceDir: workspace, draftId: draft.draftId })
    assert.equal(applied.ok, true)
    assert.equal(applied.target, 'RESEARCH_MAP.md')
    assert.ok(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' }).content.includes('AI 提议的新内容'))
    assert.equal(svc.listDrafts({ workspaceDir: workspace }).length, 0, '应用后草稿消失')
  })

  it('目标文件在草稿创建后被用户修改 → baseHash 冲突拒绝；force 显式确认可覆盖', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap', content: '第一版内容。' })
    const draft = svc.updateDraft({ workspaceDir: workspace, kind: 'researchMap', draft: '草稿内容。' })
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap', content: '用户手工修改的最新内容。' })
    const conflicted = svc.applyDraft({ workspaceDir: workspace, draftId: draft.draftId })
    assert.equal(conflicted.ok, false)
    assert.equal(conflicted.conflict, true, '冲突必须显式返回')
    assert.equal(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' }).content, '用户手工修改的最新内容。', '拒绝后用户文字未被覆盖')
    const forced = svc.applyDraft({ workspaceDir: workspace, draftId: draft.draftId, force: true })
    assert.equal(forced.ok, true)
    assert.equal(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' }).content, '草稿内容。')
  })

  it('目标原本不存在：直接应用成功；期间被创建则冲突', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const draft = svc.updateDraft({ workspaceDir: workspace, kind: 'userProfile', draft: '称呼：研究员。' })
    assert.equal(draft.targetExisted, false)
    assert.equal(draft.baseHash, null)
    const applied = svc.applyDraft({ workspaceDir: workspace, draftId: draft.draftId })
    assert.equal(applied.ok, true)
    assert.ok(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'userProfile' }).exists)
    // 变体：草稿期间目标被创建 → 冲突
    const draft2 = svc.updateDraft({ workspaceDir: workspace, kind: 'researchTaste', draft: '口味草稿。' })
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchTaste', content: '用户刚创建的文件。' })
    const conflicted = svc.applyDraft({ workspaceDir: workspace, draftId: draft2.draftId })
    assert.equal(conflicted.ok, false)
    assert.equal(conflicted.conflict, true)
  })

  it('discard 删除草稿且不触碰目标', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'projectProfile', content: '项目约定。' })
    const draft = svc.updateDraft({ workspaceDir: workspace, kind: 'projectProfile', draft: '不要的草稿。' })
    assert.equal(svc.discardDraft({ workspaceDir: workspace, draftId: draft.draftId }).ok, true)
    assert.equal(svc.listDrafts({ workspaceDir: workspace }).length, 0)
    assert.equal(svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'projectProfile' }).content, '项目约定。')
    assert.throws(() => svc.readDraft({ workspaceDir: workspace, draftId: draft.draftId }))
  })

  it('非法 draftId 被拒（路径护栏）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    assert.throws(() => svc.readDraft({ workspaceDir: workspace, draftId: '../../evil' }))
    const result = svc.applyDraft({ workspaceDir: workspace, draftId: '000000000000' })
    assert.equal(result.ok, false)
  })
})

// ── 6. 背景资料（NOTE-07/09）────────────────────────────────────────────────

describe('NOTE-07/09：背景资料可选读写', () => {
  it('四份资料缺失时读取返回空且不抛错（绝不阻塞聊天）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    for (const kind of ['researchMap', 'userProfile', 'researchTaste', 'projectProfile'] as const) {
      const doc = svc.readBackgroundDoc({ workspaceDir: workspace, kind })
      assert.equal(doc.exists, false)
      assert.equal(doc.content, '')
      assert.equal(doc.fileName, kind === 'researchMap' ? 'RESEARCH_MAP.md' : kind === 'userProfile' ? 'USER_PROFILE.md' : kind === 'researchTaste' ? 'RESEARCH_TASTE.md' : 'PROJECT_PROFILE.md')
    }
    const all = svc.readAllBackgroundDocs({ workspaceDir: workspace })
    assert.ok(!all.researchMap.exists && !all.userProfile.exists && !all.researchTaste.exists && !all.projectProfile.exists)
    assert.equal(all.userProfile.content, '')
  })

  it('写入后读回一致（RESEARCH_MAP 与 USER_PROFILE）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    const map = '# 最近在做什么\n\n目前三个方向同时推进：检索、Chat Graph、论文写作。'
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap', content: map })
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'userProfile', content: '称呼：研究员。常用语言：中文。' })
    const mapRead = svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'researchMap' })
    assert.equal(mapRead.exists, true)
    assert.equal(mapRead.content, map)
    const userRead = svc.readBackgroundDoc({ workspaceDir: workspace, kind: 'userProfile' })
    assert.equal(userRead.content, '称呼：研究员。常用语言：中文。')
    assert.ok(userRead.byteSize > 0)
  })

  it('readAllBackgroundDocs 一次取齐（含缺失与已建混合）', (t) => {
    const { svc, workspace } = makeSandbox(t)
    svc.writeBackgroundDoc({ workspaceDir: workspace, kind: 'researchTaste', content: '偏好可复现实验。' })
    const all = svc.readAllBackgroundDocs({ workspaceDir: workspace })
    assert.equal(all.researchTaste.content, '偏好可复现实验。')
    assert.equal(all.researchMap.exists, false)
    assert.equal(all.projectProfile.exists, false)
  })
})
