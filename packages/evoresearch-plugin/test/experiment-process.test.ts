/**
 * 实验进程与日志测试（EXP-05..14）。
 *
 * 覆盖：运行账本解析/裁剪、状态机（running → success/failed/user-stopped/
 * unknown）、日志分页与 tail 切片、重启恢复识别（PID+命令行匹配、日志尾部
 * 保守推断）、复盘草稿生成、Chat Graph 引用路径解析安全、短命进程集成
 * （真实 spawn 但只用瞬时脚本，不跑长进程）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ExperimentProcessService,
  RUN_LEDGER_NAME,
  RETROSPECTIVE_DRAFT_NAME,
  buildRetrospectiveDraft,
  classifyAfterRestart,
  commandLineMatches,
  decideExitStatus,
  finalizeRun,
  inferStatusFromLogTail,
  parseRunLedger,
  pruneRuns,
  resolveExperimentRelativePath,
  serializeRunLedger,
  sliceLog,
  type ProcessProbe,
  type RunRecord,
  type SpawnFn,
} from '../src/host/experiment-process.js'
import { ExperimentWorkspaceService } from '../src/host/experiment-workspace.js'

// ── 夹具 ────────────────────────────────────────────────────────────────────

let tmpRoot: string
let dataRoot: string
let projectDir: string
let workspace: ExperimentWorkspaceService

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-proc-'))
  dataRoot = path.join(tmpRoot, 'data')
  projectDir = path.join(dataRoot, 'projects', 'demo')
  fs.mkdirSync(projectDir, { recursive: true })
  workspace = new ExperimentWorkspaceService({ dataRoot })
})

afterEach(async () => {
  // Windows 下文件句柄释放是异步的：rm 失败后重试几次再放弃
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'r-test',
    command: 'python train.py',
    argv: ['cmd.exe', '/d', '/s', '/c', 'python train.py'],
    cwd: '/proj',
    pythonPath: null,
    gitCommit: null,
    startedAt: 1000,
    pid: 4242,
    status: 'running',
    exitCode: null,
    exitSignal: null,
    error: null,
    stopRequested: false,
    stoppedBy: null,
    endedAt: null,
    stdoutLog: 'stdout.log',
    stderrLog: 'stderr.log',
    recoveredAt: null,
    recoveredNote: null,
    ...overrides,
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`waitFor 超时（${timeoutMs}ms）`)
}

// ── EXP-05/14：账本解析与裁剪 ───────────────────────────────────────────────

describe('parseRunLedger / serializeRunLedger', () => {
  it('损坏 JSON → 空账本', () => {
    assert.deepEqual(parseRunLedger('not json{{{'), { version: 1, runs: [] })
    assert.deepEqual(parseRunLedger(''), { version: 1, runs: [] })
    assert.deepEqual(parseRunLedger('null'), { version: 1, runs: [] })
    assert.deepEqual(parseRunLedger('{"runs": "x"}'), { version: 1, runs: [] })
  })

  it('过滤非法条目，非法 status 归一为 unknown，保留合法字段', () => {
    const ledger = parseRunLedger(JSON.stringify({
      version: 1,
      runs: [
        null,
        { runId: 'r-1' }, // 缺 command → 丢弃
        { runId: 'r-2', command: 'echo hi', status: 'bogus', pid: 5, exitCode: 1, stopRequested: true },
      ],
    }))
    assert.equal(ledger.runs.length, 1)
    const r = ledger.runs[0]!
    assert.equal(r.runId, 'r-2')
    assert.equal(r.status, 'unknown')
    assert.equal(r.pid, 5)
    assert.equal(r.exitCode, 1)
    assert.equal(r.stopRequested, true)
    assert.equal(r.stdoutLog, 'stdout.log')
  })

  it('round-trip：serialize → parse 相等', () => {
    const ledger = { version: 1, runs: [baseRun({ status: 'success', exitCode: 0, endedAt: 2000 })] }
    const parsed = parseRunLedger(serializeRunLedger(ledger))
    assert.deepEqual(parsed.runs, ledger.runs)
    assert.equal(parsed.version, 1)
  })
})

describe('pruneRuns', () => {
  it('超出上限裁剪最旧完成记录', () => {
    const runs = [1, 2, 3, 4, 5].map((n) => baseRun({ runId: `r-${n}`, status: 'failed', startedAt: n * 100, exitCode: 1, endedAt: n * 200 }))
    const pruned = pruneRuns(runs, 3)
    assert.deepEqual(pruned.map((r) => r.runId), ['r-3', 'r-4', 'r-5'])
  })

  it('running 记录恒保留', () => {
    const runs = [
      baseRun({ runId: 'r-old', status: 'success', exitCode: 0, endedAt: 100 }),
      baseRun({ runId: 'r-run', status: 'running', startedAt: 50 }),
      baseRun({ runId: 'r-new', status: 'success', exitCode: 0, endedAt: 200 }),
    ]
    const pruned = pruneRuns(runs, 2)
    assert.deepEqual(pruned.map((r) => r.runId), ['r-run', 'r-new'])
  })
})

// ── EXP-07/14：状态机 ───────────────────────────────────────────────────────

describe('decideExitStatus / finalizeRun', () => {
  it('主动停止 → user-stopped（无论退出码/信号）', () => {
    assert.equal(decideExitStatus(true, { exitCode: null, exitSignal: 'SIGTERM', error: null }), 'user-stopped')
    assert.equal(decideExitStatus(true, { exitCode: 1, exitSignal: null, error: null }), 'user-stopped')
  })

  it('自然退出：0 → success，非 0 → failed', () => {
    assert.equal(decideExitStatus(false, { exitCode: 0, exitSignal: null, error: null }), 'success')
    assert.equal(decideExitStatus(false, { exitCode: 3, exitSignal: null, error: null }), 'failed')
  })

  it('异常消失：有 signal → unknown；spawn 错误 → failed', () => {
    assert.equal(decideExitStatus(false, { exitCode: null, exitSignal: 'SIGKILL', error: null }), 'unknown')
    assert.equal(decideExitStatus(false, { exitCode: null, exitSignal: null, error: 'ENOENT' }), 'failed')
    assert.equal(decideExitStatus(false, { exitCode: null, exitSignal: null, error: null }), 'unknown')
  })

  it('finalizeRun 落 endedAt 且保留既有字段', () => {
    const record = baseRun()
    const done = finalizeRun(record, { exitCode: 1, exitSignal: null, error: null }, 5000)
    assert.equal(done.status, 'failed')
    assert.equal(done.exitCode, 1)
    assert.equal(done.endedAt, 5000)
    assert.equal(done.command, record.command)
    assert.equal(done.runId, record.runId)
  })
})

// ── EXP-06/14：日志切片 ─────────────────────────────────────────────────────

describe('sliceLog', () => {
  const content = Buffer.from('line1\nline2\nline3\n')

  it('空内容 → eof', () => {
    assert.deepEqual(sliceLog(Buffer.alloc(0)), { text: '', nextOffset: 0, eof: true })
  })

  it('offset/limit 分页', () => {
    const p1 = sliceLog(content, { offset: 0, limit: 6 })
    assert.equal(p1.text, 'line1\n')
    assert.equal(p1.nextOffset, 6)
    assert.equal(p1.eof, false)
    const p2 = sliceLog(content, { offset: 6, limit: 6 })
    assert.equal(p2.text, 'line2\n')
    assert.equal(p2.eof, false)
    const p3 = sliceLog(content, { offset: 12, limit: 100 })
    assert.equal(p3.text, 'line3\n')
    assert.equal(p3.eof, true)
  })

  it('offset 越界 → 空 + eof', () => {
    assert.deepEqual(sliceLog(content, { offset: 100 }), { text: '', nextOffset: 18, eof: true })
  })

  it('tail 对齐行边界（窗口起点行首则整窗返回；起点行中则跳到下一行首）', () => {
    const tail = sliceLog(content, { tail: 12 })
    assert.equal(tail.text, 'line2\nline3\n')
    assert.equal(tail.eof, true)
    assert.equal(tail.nextOffset, 18)
    // 窗口从文件头开始 → 直接返回全部
    assert.equal(sliceLog(content, { tail: 100 }).text, 'line1\nline2\nline3\n')
    // 窗口内无完整行 → 空
    assert.equal(sliceLog(content, { tail: 3 }).text, '')
  })

  it('tail 0 → 空', () => {
    assert.equal(sliceLog(content, { tail: 0 }).text, '')
  })
})

// ── EXP-08/14：命令行匹配与重启恢复 ─────────────────────────────────────────

describe('commandLineMatches', () => {
  it('直接模式：exe + 首个非选项参数匹配', () => {
    const record = baseRun({ argv: ['node', 'train.py'], command: 'node train.py' })
    assert.equal(commandLineMatches(record, 'C:\\node\\node.exe train.py --epochs 5', { caseInsensitive: true }), true)
    assert.equal(commandLineMatches(record, 'python train.py'), false)
  })

  it('shell 模式：匹配命令首个 token', () => {
    const record = baseRun({ command: 'python train.py' }) // argv = cmd /d /s /c ...
    assert.equal(commandLineMatches(record, 'cmd /c python train.py', { caseInsensitive: true }), true)
    assert.equal(commandLineMatches(record, 'cmd /c python eval.py', { caseInsensitive: true }), false)
  })

  it('空命令行 → false', () => {
    assert.equal(commandLineMatches(baseRun(), '  '), false)
  })
})

describe('inferStatusFromLogTail / classifyAfterRestart', () => {
  it('失败标记保守推断', () => {
    assert.equal(inferStatusFromLogTail('Traceback (most recent call last):\n  File "x.py"'), 'failed')
    assert.equal(inferStatusFromLogTail('FATAL: out of memory'), 'failed')
    assert.equal(inferStatusFromLogTail('some normal error message'), null)
    assert.equal(inferStatusFromLogTail(''), null)
  })

  it('非 running 记录 → 不变（null）', () => {
    assert.equal(classifyAfterRestart(baseRun({ status: 'success', exitCode: 0 }), { alive: true, commandLine: 'x' }), null)
  })

  it('PID 存活 + 命令行匹配 → 保持 running 并确认归属', () => {
    const record = baseRun({ argv: ['node', 'train.py'] })
    const c = classifyAfterRestart(record, { alive: true, commandLine: 'node train.py --lr 1e-3' })
    assert.equal(c?.status, 'running')
    assert.match(String(c?.note), /匹配/)
  })

  it('PID 存活但命令行不匹配（PID 复用）→ unknown，不伪造完成', () => {
    const record = baseRun({ argv: ['node', 'train.py'] })
    const c = classifyAfterRestart(record, { alive: true, commandLine: 'totally-unrelated.exe --x' })
    assert.equal(c?.status, 'unknown')
    assert.match(String(c?.note), /复用|不匹配/)
  })

  it('进程不存在 + 日志有 Traceback → failed（保守推断）', () => {
    const record = baseRun()
    const c = classifyAfterRestart(record, { alive: false, commandLine: null }, { logTail: 'Traceback (most recent call last)' })
    assert.equal(c?.status, 'failed')
  })

  it('进程不存在 + 日志干净 → unknown', () => {
    const c = classifyAfterRestart(baseRun(), { alive: false, commandLine: null }, { logTail: 'epoch 1 done' })
    assert.equal(c?.status, 'unknown')
  })

  it('进程存在但命令行读不到 → unknown', () => {
    const c = classifyAfterRestart(baseRun(), { alive: true, commandLine: null })
    assert.equal(c?.status, 'unknown')
  })
})

// ── EXP-10/14：复盘草稿 ─────────────────────────────────────────────────────

describe('buildRetrospectiveDraft', () => {
  it('包含运行记录与状态文本', () => {
    const draft = buildRetrospectiveDraft({
      name: 'exp-a',
      runs: [
        baseRun({ runId: 'r-1', command: 'python train.py', status: 'failed', exitCode: 1, startedAt: 1000, endedAt: 4000 }),
        baseRun({ runId: 'r-2', command: 'python eval.py', status: 'running', startedAt: 5000 }),
      ],
      stderrTail: 'Traceback (most recent call last)',
      stdoutTail: '',
      now: 9000,
    })
    assert.match(draft, /实验复盘（草稿，待确认）/)
    assert.match(draft, /python train\.py/)
    assert.match(draft, /失败，退出码 1，耗时 3s/)
    assert.match(draft, /python eval\.py` — 运行中/)
    assert.match(draft, /Traceback \(most recent call last\)/)
    assert.match(draft, /appendNote/)
  })

  it('无运行记录时仍生成草稿', () => {
    const draft = buildRetrospectiveDraft({ name: 'exp-a', runs: [], stderrTail: '', stdoutTail: '', now: 1 })
    assert.match(draft, /暂无运行记录/)
  })
})

// ── EXP-11/14：引用路径解析安全 ─────────────────────────────────────────────

describe('resolveExperimentRelativePath', () => {
  it('合法相对路径解析回目录内', () => {
    const p = resolveExperimentRelativePath('C:\\exp\\a', 'artifacts/curve.png')
    assert.equal(path.normalize(p), path.normalize('C:\\exp\\a\\artifacts\\curve.png'))
  })

  it('路径穿越被拒绝', () => {
    assert.throws(() => resolveExperimentRelativePath('C:\\exp\\a', '../secret.txt'))
    assert.throws(() => resolveExperimentRelativePath('C:\\exp\\a', '..\\secret.txt'))
    assert.throws(() => resolveExperimentRelativePath('C:\\exp\\a', 'artifacts/../../secret'))
    assert.throws(() => resolveExperimentRelativePath('C:\\exp\\a', ''))
    assert.throws(() => resolveExperimentRelativePath('C:\\exp\\a', '..'))
  })
})

// ── 集成（短命进程，EXP-05..11）────────────────────────────────────────────

describe('ExperimentProcessService 集成', () => {
  /** 写一个无引号命令即可运行的 .cjs 脚本（规避 cmd 引号解析差异）。 */
  function writeScript(slug: string, code: string): string {
    const dir = path.join(projectDir, 'experiments', slug)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'job.cjs')
    fs.writeFileSync(file, code, 'utf8')
    return 'node job.cjs'
  }

  it('运行成功：账本落盘 + stdout 日志 + success', async () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'ok-run')
    const cmd = writeScript(exp.slug, "console.log('hello-from-exp')")
    const run = svc.run(projectDir, exp.slug, { command: cmd })
    assert.equal(run.status, 'running')
    assert.ok(run.runId.startsWith('r-'))
    assert.ok(fs.existsSync(path.join(exp.dir, RUN_LEDGER_NAME)), '账本文件已创建')
    await waitFor(() => svc.status(projectDir, exp.slug).running === null)
    const status = svc.status(projectDir, exp.slug)
    assert.equal(status.latest?.status, 'success')
    assert.equal(status.latest?.exitCode, 0)
    assert.ok(status.latest?.endedAt !== null)
    assert.ok(fs.existsSync(path.join(exp.dir, 'stdout.log')))
    await waitFor(() => /hello-from-exp/.test(svc.readLog(projectDir, exp.slug, 'stdout', { tail: 512 }).text))
  })

  it('运行失败：非零退出码 → failed', async () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'fail-run')
    const cmd = writeScript(exp.slug, "console.error('boom'); process.exit(3)")
    svc.run(projectDir, exp.slug, { command: cmd })
    await waitFor(() => svc.status(projectDir, exp.slug).latest?.status !== 'running')
    const latest = svc.status(projectDir, exp.slug).latest
    assert.equal(latest?.status, 'failed')
    assert.equal(latest?.exitCode, 3)
    await waitFor(() => /boom/.test(svc.readLog(projectDir, exp.slug, 'stderr', { tail: 128 }).text))
  })

  it('spawn 同步抛异常：仍写入 failed 账本记录而不是丢失运行', () => {
    const svc = new ExperimentProcessService({
      dataRoot,
      spawnImpl: ((_file, _args, _opts) => {
        throw new Error('executable unavailable')
      }) as SpawnFn,
    })
    const exp = workspace.createWorkspace('demo', 'spawn-error')
    const run = svc.run(projectDir, exp.slug, { command: 'missing-executable' })
    assert.equal(run.status, 'failed')
    assert.match(run.error ?? '', /executable unavailable/)
    assert.equal(svc.status(projectDir, exp.slug).latest?.status, 'failed')
    assert.match(fs.readFileSync(path.join(exp.dir, RUN_LEDGER_NAME), 'utf8'), /executable unavailable/)
  })

  it('stop：用户停止 → user-stopped 且不再变', async () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'stop-run')
    const cmd = writeScript(exp.slug, 'setTimeout(()=>{}, 60000)')
    const run = svc.run(projectDir, exp.slug, { command: cmd })
    assert.ok(run.pid !== null)
    await new Promise((resolve) => setTimeout(resolve, 200)) // 等 node 子进程真正起来
    const stopped = svc.stop(projectDir, exp.slug)
    assert.equal(stopped.run.status, 'user-stopped')
    assert.equal(stopped.run.stoppedBy, 'user')
    await waitFor(() => svc.status(projectDir, exp.slug).running === null)
    await waitFor(() => svc.status(projectDir, exp.slug).latest?.status === 'user-stopped')
    assert.throws(() => svc.stop(projectDir, exp.slug), /不在运行中/)
    // 等待被 kill 子进程的 close 事件在测试生命周期内处理完（避免异步尾巴）
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  it('日志分页：offset/limit 逐页读', async () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'log-page')
    const file = path.join(exp.dir, 'stdout.log')
    fs.writeFileSync(file, 'aaa\nbbb\nccc\nddd\n', 'utf8')
    const p1 = svc.readLog(projectDir, exp.slug, 'stdout', { offset: 0, limit: 8 })
    assert.equal(p1.text, 'aaa\nbbb\n')
    assert.equal(p1.eof, false)
    const p2 = svc.readLog(projectDir, exp.slug, 'stdout', { offset: p1.nextOffset, limit: 8 })
    assert.equal(p2.text, 'ccc\nddd\n')
    assert.equal(p2.eof, true)
    const info = svc.logInfo(projectDir, exp.slug)
    assert.equal(info.stdout.size, 16)
  })

  it('restartRecovery：注入假探针 → 无法确认标 unknown，确认归属标 running+recoveredAt', () => {
    const fakeProbe: ProcessProbe = { alive: () => false, commandLine: () => null }
    const svc = new ExperimentProcessService({ dataRoot, probe: fakeProbe })
    const exp = workspace.createWorkspace('demo', 'recover')
    // 手工构造 running 账本（模拟应用退出时进程仍为 running）
    const ledger = { version: 1, runs: [baseRun({ runId: 'r-1', pid: 999999 })] }
    fs.writeFileSync(path.join(exp.dir, RUN_LEDGER_NAME), serializeRunLedger(ledger), 'utf8')
    const result = svc.restartRecovery(projectDir, exp.slug)
    assert.equal(result.checked, 1)
    assert.equal(result.changed, 1)
    const recovered = svc.get(projectDir, exp.slug, 'r-1')
    assert.equal(recovered.status, 'unknown')
    assert.ok(recovered.recoveredAt !== null)
    assert.match(recovered.recoveredNote ?? '', /无法确认/)

    // 命中探针：alive + 命令行匹配 → 保持 running 并记录 recoveredAt
    const svc2 = new ExperimentProcessService({
      dataRoot,
      probe: { alive: () => true, commandLine: () => 'cmd /c python train.py' },
    })
    const ledger2 = { version: 1, runs: [baseRun({ runId: 'r-2', pid: 12345 })] }
    fs.writeFileSync(path.join(exp.dir, RUN_LEDGER_NAME), serializeRunLedger(ledger2), 'utf8')
    const result2 = svc2.restartRecovery(projectDir, exp.slug)
    assert.equal(result2.changed, 0, '状态未变（仍 running）')
    const reattached = svc2.get(projectDir, exp.slug, 'r-2')
    assert.equal(reattached.status, 'running')
    assert.ok(reattached.recoveredAt !== null, '确认归属后记录 recoveredAt')
  })

  it('retrospectiveDraft：生成草稿；saveDraft 落 .draft 文件且不写 LAB_NOTE', async () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'draft')
    const cmd = writeScript(exp.slug, "console.error('trace trace trace'); process.exit(2)")
    svc.run(projectDir, exp.slug, { command: cmd })
    await waitFor(() => svc.status(projectDir, exp.slug).latest?.status === 'failed')
    const before = fs.readFileSync(path.join(exp.dir, 'LAB_NOTE.md'), 'utf8')
    const { draft, draftPath } = svc.retrospectiveDraft(projectDir, exp.slug, { saveDraft: true })
    assert.match(draft, /实验复盘（草稿，待确认）/)
    assert.match(draft, /node job\.cjs/)
    assert.ok(draftPath !== null && fs.existsSync(draftPath))
    assert.equal(fs.readFileSync(path.join(exp.dir, 'LAB_NOTE.md'), 'utf8'), before, 'LAB_NOTE 未被草稿改动')
    assert.equal(path.basename(draftPath!), RETROSPECTIVE_DRAFT_NAME)
  })

  it('resolveGraphRef：实验/日志/笔记/产物解析与越界拒绝', () => {
    const svc = new ExperimentProcessService({ dataRoot })
    const exp = workspace.createWorkspace('demo', 'graph-ref')
    fs.mkdirSync(path.join(exp.dir, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(exp.dir, 'artifacts', 'curve.png'), 'png', 'utf8')
    const expRef = svc.resolveGraphRef({ type: 'experiment', workspaceDir: projectDir, slug: exp.slug })
    assert.equal(expRef.path, exp.dir)
    const logRef = svc.resolveGraphRef({ type: 'log', workspaceDir: projectDir, slug: exp.slug, stream: 'stderr' })
    assert.equal(logRef.path, path.join(exp.dir, 'stderr.log'))
    const noteRef = svc.resolveGraphRef({ type: 'note', workspaceDir: projectDir, slug: exp.slug })
    assert.equal(noteRef.path, path.join(exp.dir, 'LAB_NOTE.md'))
    const artRef = svc.resolveGraphRef({ type: 'artifact', workspaceDir: projectDir, slug: exp.slug, relPath: 'artifacts/curve.png' })
    assert.equal(artRef.path, path.join(exp.dir, 'artifacts', 'curve.png'))
    assert.throws(() => svc.resolveGraphRef({ type: 'artifact', workspaceDir: projectDir, slug: exp.slug, relPath: '../secret' }))
    assert.throws(() => svc.resolveGraphRef({ type: 'artifact', workspaceDir: projectDir, slug: exp.slug, relPath: 'nope.png' }))
    assert.throws(() => svc.resolveGraphRef({ type: 'bogus' as never, workspaceDir: projectDir, slug: exp.slug }))
  })

  it('appendNote/artifacts（EXP-09）：追加不覆盖，产物目录树可列出', () => {
    const exp = workspace.createWorkspace('demo', 'exp09')
    workspace.appendNote(projectDir, exp.slug, '第一轮运行失败，修复路径后重试。', { heading: '复盘' })
    const note = fs.readFileSync(path.join(exp.dir, 'LAB_NOTE.md'), 'utf8')
    assert.match(note, /## 复盘（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）/)
    assert.match(note, /第一轮运行失败/)
    fs.mkdirSync(path.join(exp.dir, 'artifacts', 'models'), { recursive: true })
    fs.writeFileSync(path.join(exp.dir, 'artifacts', 'models', 'best.pt'), 'w', 'utf8')
    const arts = workspace.artifacts(projectDir, exp.slug)
    assert.equal(arts.exists, true)
    assert.ok(arts.entries.some((e) => e.type === 'dir' && e.name === 'models'))
    assert.equal(arts.files, 1)
    const empty = workspace.createWorkspace('demo', 'exp09-empty')
    const missing = workspace.artifacts(projectDir, empty.slug)
    assert.equal(missing.exists, false)
  })
})
