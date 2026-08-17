/**
 * RET-10：精细历史搜索与回读回归测试（多主题长会话 → 不同说法查询 →
 * 命中正确片段 → 前后文读取 → 具体回答依据）。
 *
 * 覆盖 RET-01..09 的存储/检索/回读纯逻辑（不依赖 cordis，不跑 E2E）：
 * 片段索引建立与断点续做、可定位命中与相邻扩展、会话内二次搜索、范围翻页、
 * 完整轮次原文（含工具/中断）、记忆文件分页、FTS 退化（LIKE / embedding 失败）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ResearchMemoryStore, LONG_TEXT_THRESHOLD } from '../src/host/memory/store.js'
import { backfillFragmentIndex } from '../src/host/memory/backfill.js'
import { retrieve, type EmbeddingProvider } from '../src/host/memory/retrieval.js'
import {
  expandFragmentHit,
  expandFragmentContext,
  readConversationRange,
  turnDetail,
  readMemoryFilePaged,
  type ConversationItem,
} from '../src/host/memory/read.js'

/** 构造一个轮次并归档（assistant 多自然段；可选工具事件/中断）。 */
function seedTurn(
  store: ResearchMemoryStore,
  input: {
    turnId: string
    sessionId: string
    userText: string
    assistantText: string
    status?: 'completed' | 'interrupted'
    interruptReason?: 'user_stop' | 'api_failure'
    partialNote?: string
    tools?: Array<{ seq: number; kind: 'call' | 'result'; callId: string; name?: string; arguments?: string; result?: string }>
  },
): void {
  store.createPendingTurn({
    turnId: input.turnId,
    sessionId: input.sessionId,
    workspaceDir: '',
    userText: input.userText,
    categories: ['general'],
    topicKeys: [],
  })
  store.updateTurn(input.turnId, {
    status: input.status ?? 'completed',
    assistantText: input.assistantText,
    ...(input.interruptReason ? { interruptReason: input.interruptReason } : {}),
    ...(input.partialNote ? { partialNote: input.partialNote } : {}),
  })
  store.archiveTurn(store.getTurn(input.turnId)!, { tools: input.tools })
}

/** 固定回归语料：半年后要回忆的「长聊天」多主题会话。 */
const DRAMA_TURN = {
  turnId: 't-drama',
  sessionId: 's-long',
  userText: '我们上个月讨论的那部美剧，为什么第三季角色动机变了？',
  assistantText:
    '关于《城市边缘》第三季的角色动机变化，我们当时的分析有三个原因：\n\n' +
    '1. 编剧团队换人：第二季结束后主创离职，新编剧对角色理解不同，动机线被重写。\n\n' +
    '2. 演员档期冲突：剧本为演员档期调整，角色弧光被压缩，转折显得生硬。\n\n' +
    '3. 平台拉新压力：平台要求吸引新观众，剧情转向更戏剧化的冲突。\n\n' +
    '结论：动机变化主要是制作层面的选择，不是角色自然发展。',
}

const CIFAR_TURN = {
  turnId: 't-cifar',
  sessionId: 's-long',
  userText: 'CIFAR-10 上注意力机制的效果怎么样？',
  assistantText:
    '我们在 CIFAR-10 上对比了 ResNet 与带注意力模块的变体：\n\n' +
    '- 带 SE 模块的版本准确率 95.2%，比基线高 1.8 个点；\n\n' +
    '- 训练时间增加约 20%。\n\n' +
    '结论：注意力模块在小数据集上有稳定增益。',
}

const SURVEY_TURN = {
  turnId: 't-survey',
  sessionId: 's-long',
  userText: '综述里引用哪几篇注意力论文？',
  assistantText:
    '综述的核心引用包括 Vaswani 2017 的 Transformer 与 SENet 两篇。\n\n' +
    '其余按方法类别展开，详见文献库。',
}

/** 语料库：s-long 多主题长会话 + s-other 无关会话。 */
function buildCorpus(store: ResearchMemoryStore): void {
  seedTurn(store, {
    turnId: 't-0',
    sessionId: 's-long',
    userText: '我们开始整理科研笔记，先聊聊最近看的美剧。',
    assistantText: '好的，我们先从美剧话题开始。\n\n这是开场白。',
  })
  seedTurn(store, DRAMA_TURN)
  seedTurn(store, {
    turnId: 't-attn',
    sessionId: 's-long',
    userText: '注意力机制的最新进展有哪些？',
    assistantText: '注意力机制的最新进展包括线性注意力与稀疏注意力。\n\n两者都在长序列上降低复杂度。',
  })
  seedTurn(store, CIFAR_TURN)
  seedTurn(store, SURVEY_TURN)
  // 工具调用轮次：read_file + 长结果
  seedTurn(store, {
    turnId: 't-tool',
    sessionId: 's-long',
    userText: '读一下实验日志文件',
    assistantText: '我读取了实验日志，摘要如下：\n\n训练 loss 稳定下降，验证集表现正常。',
    tools: [
      { seq: 30, kind: 'call', callId: 'call_1', name: 'read_file', arguments: '{"path":"logs/run1.txt"}' },
      { seq: 31, kind: 'result', callId: 'call_1', result: 'epoch=50 loss=0.32 acc=0.942' },
    ],
  })
  // 中断轮次：API 失败（部分正文 + 说明）
  seedTurn(store, {
    turnId: 't-interrupt',
    sessionId: 's-long',
    userText: '继续翻译那段英文摘要',
    assistantText: '翻译：The proposed method achieves state-of-the-art',
    status: 'interrupted',
    interruptReason: 'api_failure',
    partialNote: '回答被中断（API 失败）：已保留已生成的部分正文（41 字符）。',
  })
  // 无关会话
  seedTurn(store, {
    turnId: 't-other',
    sessionId: 's-other',
    userText: '今天天气不错，中午吃什么？',
    assistantText: '天气确实不错。\n\n建议吃火锅。',
  })
}

describe('RET-01/02：片段索引建立与断点续做', () => {
  it('从 research_turns + 归档回填片段索引；重复执行幂等（中断后继续）', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    const result = await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p', sourceVersion: 'v1' })
    assert.equal(result.built, 8)
    assert.equal(result.skipped, 0)
    // 每轮都有片段
    for (const turnId of ['t-drama', 't-cifar', 't-tool', 't-interrupt', 't-other']) {
      assert.ok(store.countTurnFragments(turnId) > 0, `${turnId} 应有片段`)
    }
    // 进度落盘
    const progress = store.getFragmentIndexProgress('/mem', 'p')
    assert.equal(progress?.status, 'complete')
    assert.equal(progress?.progress.built, 8)
    // 断点续做：重跑全部跳过（不重复插入）
    const again = await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p', sourceVersion: 'v2' })
    assert.equal(again.built, 0)
    assert.equal(again.skipped, 8)
    // 模拟中断后的部分完成：删掉一个轮的片段 → 重跑只补它
    store.db.db.prepare('DELETE FROM turn_fragments WHERE turn_id = ?').run('t-cifar')
    const resume = await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p', sourceVersion: 'v3' })
    assert.equal(resume.built, 1)
    assert.equal(resume.skipped, 7)
    store.close()
  })

  it('片段保存回到原文的位置：session_id + seg_seq + 段内偏移；自然段级切分', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const fragments = store.listTurnFragments('t-drama')
    const assistantFrags = fragments.filter((f) => f.kind === 'assistant')
    // 多自然段 → 多片段（frag_index 0/1/2/3）
    assert.ok(assistantFrags.length >= 3, `assistant 应按自然段切分，实际 ${assistantFrags.length}`)
    for (const frag of fragments) {
      assert.equal(frag.sessionId, 's-long')
      assert.ok(frag.segSeq >= 0)
      assert.ok(frag.charOffset >= 0)
      assert.ok(frag.charLen > 0)
      assert.ok(frag.content.length > 0)
    }
    // 段落 0 含第一句
    const first = [...assistantFrags].sort((a, b) => a.fragIndex - b.fragIndex)[0]!
    assert.equal(first.fragIndex, 0)
    assert.ok(first.content.includes('角色动机变化'))
    store.close()
  })

  it('无归档轮次（进程崩溃遗留）从 session log 兜底建片段', async () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't-log', sessionId: 's-x', workspaceDir: '', userText: '记录一下实验结果', categories: [], topicKeys: [] })
    store.updateTurn('t-log', { status: 'completed', assistantText: '' })
    // 无 segments（未归档）→ 依赖 eventsOf
    const events = [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: '记录一下实验结果' }], source: { kind: 'user' } } },
      { type: 'assistant/chunk', seq: 3, data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '准确率 96%' } } },
      { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p', eventsOf: () => events })
    const fragments = store.listTurnFragments('t-log')
    assert.equal(fragments.length, 2)
    assert.equal(fragments[0]?.kind, 'user')
    assert.equal(fragments[1]?.kind, 'assistant')
    assert.ok(fragments[1]?.content.includes('准确率 96%'))
    store.close()
  })
})

describe('RET-10 核心回归：多主题长会话 → 不同说法查询 → 命中正确片段', () => {
  it('半年后询问美剧细节：命中角色动机片段而不是 CIFAR 轮次', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    // 不同说法 1：直接问动机
    const hits1 = store.searchFragments('角色动机', 10)
    assert.ok(hits1.length > 0)
    assert.ok(hits1.every((h) => h.fragment.turnId === 't-drama'), '角色动机 应只命中美剧轮')
    // 不同说法 2：问编剧
    const hits2 = store.searchFragments('编剧团队', 10)
    assert.ok(hits2.length > 0)
    assert.ok(hits2.every((h) => h.fragment.turnId === 't-drama'))
    // 不同说法 3：问演员
    const hits3 = store.searchFragments('演员档期', 10)
    assert.ok(hits3.length > 0)
    assert.ok(hits3.every((h) => h.fragment.turnId === 't-drama'))
    store.close()
  })

  it('查询 CIFAR 实验命中实验轮次，不串到美剧话题', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const hits = store.searchFragments('准确率 95.2', 10)
    assert.ok(hits.length > 0)
    assert.ok(hits.every((h) => h.fragment.turnId === 't-cifar'), '准确率查询应命中 CIFAR 轮')
    const hits2 = store.searchFragments('注意力模块', 10)
    assert.ok(hits2.every((h) => h.fragment.turnId === 't-cifar'))
    store.close()
  })
})

describe('RET-03/RET-08：可定位片段与相邻消息扩展', () => {
  it('命中返回位置 + 前后文，避免孤立句子误解结论', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const [hit] = store.searchFragments('演员档期', 5)
    assert.ok(hit)
    const expanded = expandFragmentHit(store, hit.fragment, hit.score)
    assert.equal(expanded.kind, 'fragment')
    assert.equal(expanded.turnId, 't-drama')
    assert.equal(expanded.sessionId, 's-long')
    // 位置字段（回到会话原文：seg_seq + 段内偏移）
    assert.ok(expanded.position.segSeq >= 0)
    assert.ok(expanded.position.charOffset >= 0)
    assert.ok(expanded.position.charLen > 0)
    // 前后文：紧邻的前一条是用户消息（prev 末尾），后一条相邻段
    const prevTexts = expanded.prev.map((item) => item.text)
    assert.ok(prevTexts.some((t) => t.includes('美剧')), '前文应包含用户提问')
    assert.ok(expanded.next.length > 0 || expanded.prev.length > 0)
    // 紧邻命中段的前一条即该轮用户消息（命中段本身由 position 定位）
    assert.equal(expanded.prev[expanded.prev.length - 1]?.kind, 'user')
    store.close()
  })

  it('工具片段命中时前后文包含 assistant 原文（回答依据可追溯）', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const [hit] = store.searchFragments('read_file', 5)
    assert.ok(hit)
    const expanded = expandFragmentHit(store, hit.fragment, hit.score)
    assert.equal(expanded.turnId, 't-tool')
    const prevTexts = expanded.prev.map((item) => item.text)
    assert.ok(prevTexts.some((t) => t.includes('实验日志')), '工具命中前应有 assistant 摘要')
    const nextTexts = expanded.next.map((item) => item.text)
    assert.ok(nextTexts.some((t) => t.includes('epoch=50')), '工具命中后应有工具结果')
    // expandFragmentContext 直接可用
    const context = expandFragmentContext(store, 's-long', 't-tool', hit.fragment.segSeq, 2, 2)
    assert.ok(context.anchor)
    assert.equal(context.anchor.kind, 'tool')
    store.close()
  })
})

describe('RET-04：find_in_conversation（会话内二次搜索）', () => {
  it('指定会话内查找：命中只属于该会话；无关会话无命中', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const inLong = store.searchFragments('美剧', 10, { sessionId: 's-long' })
    assert.ok(inLong.length > 0)
    assert.ok(inLong.every((h) => h.fragment.sessionId === 's-long'))
    const inOther = store.searchFragments('美剧', 10, { sessionId: 's-other' })
    assert.equal(inOther.length, 0)
    // 天气话题在 s-other 内可查
    const weather = store.searchFragments('火锅', 10, { sessionId: 's-other' })
    assert.ok(weather.length > 0)
    assert.equal(weather[0]?.fragment.turnId, 't-other')
    store.close()
  })
})

describe('RET-05：read_conversation_range 前后翻页', () => {
  it('锚点模式：围绕命中位置返回前后窗口', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    // 取 t-drama 的 assistant 段为锚（seg 1）
    const dramaSegs = store.listSegments('t-drama')
    const assistantSeg = dramaSegs.find((s) => s.kind === 'assistant')!
    const result = readConversationRange(store, 's-long', {
      anchor: { turnId: 't-drama', segSeq: assistantSeg.seq },
      before: 1,
      after: 1,
    })
    assert.ok(result.anchorIndex !== null)
    const items = result.items as ConversationItem[]
    assert.ok(items.length >= 2)
    assert.equal(items[result.anchorIndex!]?.turnId, 't-drama')
    // 前一条为该轮用户消息
    assert.equal(items[result.anchorIndex! - 1]?.kind, 'user')
    store.close()
  })

  it('无锚点模式：最近 N 条 + offset 向前翻旧页', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const total = store.conversationSegments('s-long').length
    assert.ok(total > 5)
    const latest = readConversationRange(store, 's-long', { limit: 5 })
    assert.equal(latest.items.length, 5)
    assert.equal(latest.total, total)
    // offset 一页 → 上一页内容不同
    const previous = readConversationRange(store, 's-long', { limit: 5, offset: 5 })
    assert.equal(previous.items.length, 5)
    assert.notDeepEqual(
      previous.items.map((i) => i.segSeq),
      latest.items.map((i) => i.segSeq),
    )
    store.close()
  })
})

describe('RET-06：read_research_turn 完整原文（工具/中断，旧字段兼容）', () => {
  it('工具轮次：turn 旧字段保留 + 工具段解析（含长结果文件位置）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-ret-'))
    const archivesDir = path.join(dir, 'archives')
    const store = ResearchMemoryStore.openMemory(archivesDir)
    const big = `完整实验日志\n${'y'.repeat(LONG_TEXT_THRESHOLD + 100)}`
    seedTurn(store, {
      turnId: 't-big',
      sessionId: 's-long',
      userText: '读大文件',
      assistantText: '已读取。',
      tools: [
        { seq: 10, kind: 'call', callId: 'call_big', name: 'read_file', arguments: '{"path":"big.txt"}' },
        { seq: 11, kind: 'result', callId: 'call_big', result: big },
      ],
    })
    const detail = turnDetail(store, 't-big')!
    // 旧字段兼容
    assert.equal(detail.turn.turnId, 't-big')
    assert.equal(detail.turn.userText, '读大文件')
    assert.equal(detail.turn.assistantText, '已读取。')
    assert.equal(detail.turn.status, 'completed')
    // 工具段：按 seq 顺序、JSON 解析
    const toolSegs = detail.segments.filter((s) => s.kind === 'tool')
    assert.equal(toolSegs.length, 2)
    assert.equal(toolSegs[0]?.tool?.kind, 'call')
    assert.equal(toolSegs[0]?.tool?.name, 'read_file')
    assert.equal(toolSegs[1]?.tool?.kind, 'result')
    assert.ok(toolSegs[1]?.tool?.resultFile)
    // 长结果文件真实存在
    assert.equal(toolSegs[1]?.tool?.resultFileExists, true)
    assert.equal(fs.readFileSync(toolSegs[1]!.tool!.resultFile!, 'utf8'), big)
    // 文本段
    assert.ok(detail.segments.some((s) => s.kind === 'user' && s.text === '读大文件'))
    store.close()
  })

  it('中断轮次：partialNote/interruptReason 返回；缺失轮次返回 undefined', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    const detail = turnDetail(store, 't-interrupt')!
    assert.equal(detail.turn.status, 'interrupted')
    assert.equal(detail.turn.interruptReason, 'api_failure')
    assert.ok(detail.turn.partialNote?.includes('回答被中断'))
    assert.equal(detail.turn.assistantText, '翻译：The proposed method achieves state-of-the-art')
    // note 段入档
    assert.ok(detail.segments.some((s) => s.kind === 'note'))
    assert.equal(turnDetail(store, 't-missing'), undefined)
    store.close()
  })
})

describe('RET-07：read_memory offset/cursor 分页', () => {
  it('长笔记分页读取：不截断后无法继续；旧调用（无 offset）行为不变', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-readmem-'))
    const memoriesRoot = path.join(dir, 'memories')
    fs.mkdirSync(memoriesRoot, { recursive: true })
    const longBody = Array.from({ length: 600 }, (_, i) => `第 ${i} 行：注意力机制笔记内容 ${'x'.repeat(20)}`).join('\n')
    fs.writeFileSync(path.join(memoriesRoot, 'long.md'), longBody, 'utf8')

    // 旧行为：无 offset/limit → 前 6000 字符
    const page0 = readMemoryFilePaged(memoriesRoot, 'long.md') as { content: string; totalChars: number; hasMore: boolean; offset: number }
    assert.equal(page0.content.length, 6000)
    assert.ok(page0.hasMore)
    assert.ok(page0.totalChars > 6000)

    // 游标翻页：offset=6000 → 下一页；最后一页 hasMore=false
    const page1 = readMemoryFilePaged(memoriesRoot, 'long.md', 6000, 6000) as { content: string; hasMore: boolean; totalChars: number }
    assert.equal(page1.content.length, Math.min(6000, page1.totalChars - 6000))
    assert.equal(page1.content, longBody.slice(6000, 12000))

    // 全量拼接 = 原文
    let whole = ''
    let offset = 0
    for (;;) {
      const page = readMemoryFilePaged(memoriesRoot, 'long.md', offset, 6000) as { content: string; hasMore: boolean }
      whole += page.content
      if (!page.hasMore) break
      offset += 6000
    }
    assert.equal(whole, longBody)

    // 越界与不存在
    assert.ok('error' in readMemoryFilePaged(memoriesRoot, '../outside.md'))
    assert.ok('error' in readMemoryFilePaged(memoriesRoot, 'nope.md'))
  })
})

describe('RET-09：FTS 不可用 / embedding 失败时的退化', () => {
  it('LIKE 原文扫描回退路径可用（% _ 转义、按会话过滤）', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    // 显式 LIKE 模式
    const like = store.searchFragments('角色动机', 5, { mode: 'like' })
    assert.ok(like.length > 0)
    assert.ok(like.every((h) => h.fragment.turnId === 't-drama'))
    // 带会话过滤
    const likeScoped = store.searchFragments('火锅', 5, { sessionId: 's-other', mode: 'like' })
    assert.equal(likeScoped.length, 1)
    // 含 % 的查询不破坏 LIKE 语法（转义后应无命中而非报错）
    const escaped = store.searchFragments('100%准确', 5, { mode: 'like' })
    assert.ok(Array.isArray(escaped))
    // 轮次级 LIKE 回退
    const turns = store.searchTurnsLike('美剧', 5)
    assert.ok(turns.length > 0)
    store.close()
  })

  it('auto 模式：FTS 异常自动退化为 LIKE，不抛错', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    // 破坏 FTS 的输入（纯标点）→ toFtsQuery 为空 → LIKE 路径
    const hits = store.searchFragments('。。。？？', 5, { mode: 'auto' })
    assert.ok(Array.isArray(hits))
    // 显式 fts 模式 + 空查询 → 也走 LIKE 兜底
    const hits2 = store.searchFragments('火锅', 5, { mode: 'fts' })
    assert.equal(hits2.length, 1)
    store.close()
  })

  it('embedding 服务失败：retrieve 静默退化，FTS 结果仍返回', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    const broken: EmbeddingProvider = {
      ready: true,
      embed: async () => {
        throw new Error('embedding 服务不可用')
      },
      similarity: () => 0,
    }
    const hits = await retrieve(store, '注意力机制', { embeddings: broken, limit: 5 })
    assert.ok(hits.length > 0)
    assert.ok(hits.some((h) => h.kind === 'turn'))
    store.close()
  })

  it('FTS 索引整体重建包含片段表（rebuildFtsIndexes 后检索仍可用）', async () => {
    const store = ResearchMemoryStore.openMemory()
    buildCorpus(store)
    await backfillFragmentIndex(store, { memoryDir: '/mem', projectId: 'p' })
    store.rebuildFtsIndexes()
    const hits = store.searchFragments('角色动机', 5)
    assert.ok(hits.length > 0)
    store.close()
  })
})
