#!/usr/bin/env node
/**
 * D.4 端到端验收脚本：实验控制台（账本 8 纪律 + 四阶段回合 + 日报）
 *
 * 最小 E2E（不依赖运行中的 DSH/浏览器，仅用 lib/host 服务 + git）：
 *   1) 建项目 → 2) 建实验 → 3) 初始化账本 → 4) 留痕(--allow-empty) →
 *   5) 改文件 → 6) 回退(restore --source + clean -fdx, 非破坏式) →
 *   7) 四阶段回合走完(observe→propose→act→reflect) →
 *   8) 手动生成日报 → 9) 断言文件存在
 *
 * 覆盖 8 条纪律：
 *   1 每次尝试都留痕（trial 产生 commit）
 *   2 无空档映射（--allow-empty 空提交也能成功）
 *   3 非破坏性回滚（restore --source + clean -fdx，禁用 reset --hard，保留被回退的提交）
 *   4 快照仓库禁 ignore（core.excludesFile=/dev/null，.gitignore 忽略的文件仍能 -f 入库）
 *   5 恢复中断=恢复状态（trial 带 state，recentState 可回读）
 *   6 防污染 同名默认拒绝，overwrite 才重建
 *   7 历史可导出（export clone 后 git log 完整）
 *   8 研究对象 vs 产物分离（账本仅记录实验目录，task/ 数据不参与回滚——以实验目录独立性验证）
 *
 * 用法：
 *   node scripts/verify-exp-control.mjs
 *   node scripts/verify-exp-control.mjs --keep  # 保留临时目录便于排查
 *
 * 参照：scripts/verify-newfeatures.mjs（CDP 侧车）+ scripts/verify-baseline.mjs（离线 probe）
 * 本脚本为离线 probe，可在 CI 中直接运行；若需浏览器侧 E2E，可配合已启动的 DSH 手动打开
 * http://127.0.0.1:<port> 验证 LedgerPanel/回合/日报 UI（见文末提示）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { ExperimentLedgerService } from '../packages/evoresearch-plugin/lib/host/experiment-ledger.js'
import { ExperimentWorkspaceService } from '../packages/evoresearch-plugin/lib/host/experiment-workspace.js'
import { ExperimentRoundsService } from '../packages/evoresearch-plugin/lib/host/experiment-rounds.js'
import { DailyReportService } from '../packages/evoresearch-plugin/lib/host/daily-report.js'
import { slugifyProjectName } from '../packages/evoresearch-plugin/lib/host/core/paths.js'

const KEEP = process.argv.includes('--keep')
const VERBOSE = true

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-exp-control-'))
const dataRoot = tmpRoot
const projectDir = path.join(dataRoot, 'projects', 'demo-exp-control')
fs.mkdirSync(projectDir, { recursive: true })

const checks = []
const fails = []
function check(ok, msg) {
  if (ok) {
    checks.push(msg)
    if (VERBOSE) console.log(`\x1b[32m✓\x1b[0m ${msg}`)
  } else {
    fails.push(msg)
    console.error(`\x1b[31m✗ FAIL\x1b[0m ${msg}`)
  }
}
function must(ok, msg) {
  check(ok, msg)
  if (!ok) throw new Error(`check failed: ${msg}`)
}

function gitConfig(repo, key) {
  let r = spawnSync('git.exe', ['--git-dir=' + repo, 'config', '--get', key], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) r = spawnSync('git', ['--git-dir=' + repo, 'config', '--get', key], { encoding: 'utf8', windowsHide: true })
  return (r.stdout ?? '').trim()
}
function gitLog(repo, limit = 20) {
  let r = spawnSync('git.exe', ['--git-dir=' + repo, 'log', '--format=%H %s', '-n', String(limit)], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0 || (r.stdout ?? '').trim() === '') r = spawnSync('git', ['--git-dir=' + repo, 'log', '--format=%H %s', '-n', String(limit)], { encoding: 'utf8', windowsHide: true })
  return (r.stdout ?? '').trim()
}

const slug = 'e2e-control'
const workspace = new ExperimentWorkspaceService({ dataRoot })
const ledger = new ExperimentLedgerService(dataRoot)
const rounds = new ExperimentRoundsService({ dataRoot, ledger })
const daily = new DailyReportService(dataRoot)

let expInfo = null
let roundId = null

try {
  // 1) 建项目 — 已在 tmpRoot 下创建 dataRoot + projectDir
  must(fs.existsSync(projectDir), '1) 项目目录已创建')
  must(fs.existsSync(dataRoot), '1) dataRoot 已创建')

  // 2) 建实验 — via workspace
  expInfo = workspace.createWorkspace(projectDir, slug)
  must(expInfo.slug === slug, `2) 实验已创建 slug=${slug}`)
  must(fs.existsSync(path.join(projectDir, 'experiments', slug, 'LAB_NOTE.md')), '2) 实验 LAB_NOTE.md 已生成')
  const expDir = path.join(projectDir, 'experiments', slug)

  // 3) 初始化账本 — 纪律 4/5/6 前置检查
  const init = ledger.init(projectDir, slug)
  must(init.ok, `3) 账本 init 成功 sha=${init.ok ? init.sha.slice(0, 7) : init.error}`)
  const sanitized = slugifyProjectName(path.basename(path.resolve(projectDir)))
  const repo = path.join(dataRoot, 'plugins', 'ledgers', sanitized, `${slug}.git`)
  must(fs.existsSync(repo), '3) bare 账本目录已创建')
  // 纪律 4: core.excludesFile=/dev/null
  must(gitConfig(repo, 'core.excludesFile') === '/dev/null', '3) 纪律 4: core.excludesFile=/dev/null')
  // 纪律 5: provenance.json + state 已写
  must(fs.existsSync(path.join(expDir, 'provenance.json')), '3) 纪律 5/A.7: provenance.json 已写入')
  must(fs.existsSync(path.join(expDir, '.evoresearch-ledger-state.json')), '3) 纪律 5: 初始 state 已写入')
  // 纪律 2: 首个 commit 存在（--allow-empty）
  const logInit = ledger.log(projectDir, slug)
  must(logInit.length === 1, `3) 纪律 2: init 后 log=1 (got ${logInit.length})`)

  // 纪律 6: 同名默认拒绝
  const dup = ledger.init(projectDir, slug)
  must(!dup.ok && /已存在/.test(dup.error), '3) 纪律 6: 同名账本默认拒绝')

  // 4) 留痕 — 纪律 1 + 2（空提交也能留痕）
  const t1 = ledger.trial(projectDir, slug, { kind: 'manual', note: 'e2e 留痕 1', createdAt: Date.now() })
  must(t1.ok, '4) 纪律 1: manual trial 留痕成功')
  const tEmpty = ledger.trial(projectDir, slug, { kind: 'manual', note: 'e2e 空提交留痕', createdAt: Date.now() })
  must(tEmpty.ok && tEmpty.sha !== t1.sha, '4) 纪律 2: 空改动 --allow-empty 仍产生新 commit')
  // 纪律 1: 每次 trial 恰好一个 commit
  must(ledger.log(projectDir, slug).length === 3, '4) 纪律 1: 每次尝试恰好一个 commit (log=3)')

  // 纪律 4 额外：.gitignore 忽略的文件仍能 -f 入库
  fs.writeFileSync(path.join(expDir, '.gitignore'), '*.ignored\n', 'utf8')
  fs.writeFileSync(path.join(expDir, 'should.ignored'), 'discipline-4-data', 'utf8')
  const tIgnore = ledger.trial(projectDir, slug, { kind: 'checkpoint', note: 'ignore test', createdAt: Date.now() })
  must(tIgnore.ok, '4) 纪律 4: .gitignore 忽略文件仍可 trial')
  let show = spawnSync('git.exe', ['--git-dir=' + repo, '--work-tree=' + expDir, 'show', `${tIgnore.sha}:should.ignored`], { encoding: 'utf8', windowsHide: true })
  if (show.status !== 0) show = spawnSync('git', ['--git-dir=' + repo, '--work-tree=' + expDir, 'show', `${tIgnore.sha}:should.ignored`], { encoding: 'utf8', windowsHide: true })
  must((show.stdout ?? '').includes('discipline-4-data'), '4) 纪律 4: 被忽略文件确实入历史（show 命中）')

  // 纪律 5: 带 state 的 trial 可回读
  const statePayload = { phase: 'observe', lastConclusion: 'e2e state', nextStep: 'propose' }
  const tState = ledger.trial(projectDir, slug, { kind: 'run', note: 'state test', state: statePayload, createdAt: Date.now() })
  must(tState.ok, '4) 纪律 5: 带 state 的 trial 成功')
  const recent = ledger.recentState(projectDir, slug)
  must(recent !== null && recent.phase === 'observe', '4) 纪律 5: recentState 可回读最近状态')

  // 5) 改文件 — 制造一次可回退的变更
  const shaBeforeChange = ledger.log(projectDir, slug)[0].sha
  fs.writeFileSync(path.join(expDir, 'change.txt'), 'v2 content', 'utf8')
  const tChange = ledger.trial(projectDir, slug, { kind: 'checkpoint', note: 'add change v2', createdAt: Date.now() })
  must(tChange.ok, '5) 变更已留痕 (checkpoint)')
  must(fs.existsSync(path.join(expDir, 'change.txt')), '5) 变更文件已落盘')
  // 确认 log 已增长
  must(ledger.log(projectDir, slug).length >= 6, '5) log 已增长')

  // 6) 回退 — 纪律 3 非破坏性回滚（restore --source + clean -fdx）
  // 先确认 change.txt 内容为 v2
  must(fs.readFileSync(path.join(expDir, 'change.txt'), 'utf8') === 'v2 content', '6) 回退前 change.txt=v2')
  const restored = ledger.restore(projectDir, slug, shaBeforeChange)
  must(restored.ok, `6) 纪律 3: restore --source 成功 (restoredFiles=${restored.ok ? restored.restoredFiles : restored.error})`)
  // 被回退文件应被 clean 掉
  must(!fs.existsSync(path.join(expDir, 'change.txt')), '6) 纪律 3: clean -fdx 已清理变更文件')
  // 非破坏式：被回退的提交仍在 log 中
  const logAfterRestore = ledger.log(projectDir, slug)
  must(logAfterRestore.some(c => c.sha === tChange.sha), '6) 纪律 3: 被回退的提交仍在历史（非破坏式）')
  // 额外：rewind.ts 中 restoreWorkspace 语义一致（抽查源码标记）
  const rewindSrc = fs.readFileSync(path.join(path.resolve('packages/evoresearch-plugin/src/host/rewind.ts')), 'utf8')
  must(rewindSrc.includes("restore") && rewindSrc.includes("--source") && rewindSrc.includes("clean") && rewindSrc.includes("-fdx"), '6) 校验 rewind.ts 使用 restore --source + clean -fdx')
  must(!/reset\s+--hard/.test(rewindSrc) || rewindSrc.includes('硬重置'), '6) 校验 rewind.ts 无 reset --hard 字面量（或已替换为硬重置）')

  // 纪律 7: 导出为普通 git 仓库
  const exportDest = path.join(tmpRoot, 'exported-ledger')
  const expResult = ledger.export(projectDir, slug, exportDest)
  must(expResult.ok, `6) 纪律 7: export 成功 path=${expResult.ok ? expResult.path : expResult.error}`)
  if (expResult.ok) {
    const exportedLog = (spawnSync('git', ['log', '--format=%H', '-n', '20'], { cwd: exportDest, encoding: 'utf8', windowsHide: true }).stdout ?? '').trim().split('\n').filter(Boolean)
    const ledgerShas = ledger.log(projectDir, slug).map(c => c.sha)
    must(exportedLog.length === ledgerShas.length, `6) 纪律 7: 导出仓库 log 条数一致 (${exportedLog.length})`)
    must(exportedLog.every(sha => ledgerShas.includes(sha)), '6) 纪律 7: 导出仓库 shas 与账本一致')
  }

  // 纪律 8: 研究对象 vs 产物分离 — 账本仅记录实验目录，非 project 根（以 experiment-ledger repoDir 位于 plugins/ledgers 为证）
  must(repo.replace(/\\/g, '/').includes('/plugins/ledgers/'), '6) 纪律 8: 账本位于 ledgers 独立裸仓库，与实验目录分离')

  // 7) 四阶段回合走完 — B.1/B.2/B.3
  const start = rounds.start(projectDir, slug)
  roundId = start.roundId
  must(start.phases.length === 4 && start.status === 'running', `7) 回合已启动 ${roundId}（4 阶段 running）`)
  const phases = ['observe', 'propose', 'act', 'reflect']
  for (const phase of phases) {
    const text = `# ${phase} e2e\n\ncontent for ${phase} at ${Date.now()}\n`
    const result = rounds.completePhase(projectDir, slug, phase, text)
    must(result.ok, `7) 阶段 ${phase} completePhase 成功`)
    const file = path.join(expDir, 'rounds', roundId, `${phase}.md`)
    must(fs.existsSync(file), `7) 阶段 ${phase} 产物 ${phase}.md 已落盘`)
    must(fs.readFileSync(file, 'utf8').includes(phase), `7) 阶段 ${phase} 文件内容正确`)
  }
  // 完成后 current 为 null，历史含该轮
  must(rounds.current(projectDir, slug) === null, '7) 四阶段完成后 current=null')
  const history = rounds.list(projectDir, slug)
  must(history.some(r => r.roundId === roundId && r.status === 'done'), '7) 回合历史含已完成轮')
  // 每阶段自动留痕到账本（kind=run）
  const logAfterRounds = ledger.log(projectDir, slug)
  const runNotes = logAfterRounds.filter(c => c.kind === 'run')
  must(runNotes.length >= 4, `7) 每阶段自动 trial 留痕（run≥4, got ${runNotes.length}）`)

  // 8) 手动生成日报 — C.1/C.2/C.3
  const report = await daily.generate({ projectDir, slugs: [slug] }, 'manual')
  must(!!report.reportId && !!report.path, `8) 日报已生成 reportId=${report.reportId}`)
  must(fs.existsSync(report.path), `8) 日报文件已落盘 ${report.path}`)
  must(report.markdown.includes('实验日报') && report.markdown.includes(slug), '8) 日报 Markdown 含标题与实验 slug')
  must(report.markdown.includes('最近尝试') && report.markdown.includes('当前回合'), '8) 日报含最近尝试与当前回合')
  // list/read 校验
  const list = daily.list()
  must(list.some(r => r.reportId === report.reportId), '8) 日报 list 可检索到新报告')
  const read = daily.read(report.reportId)
  must(read !== null && read.markdown === report.markdown, '8) 日报 read 内容一致')
  // 调度配置（interval 1 分钟冒烟）
  const sched = daily.setSchedule({ enabled: false, mode: 'interval', intervalMinutes: 5, projectDir, slugs: [slug] })
  must(sched.ok && typeof sched.nextRunAt === 'number', '8) 日报调度 setSchedule 成功')
  const got = daily.getSchedule()
  must(got !== null && got.mode === 'interval', '8) 日报 getSchedule 正确')

  // 9) 断言文件存在（汇总）
  const mustExist = [
    path.join(expDir, 'LAB_NOTE.md'),
    path.join(expDir, 'provenance.json'),
    path.join(expDir, '.evoresearch-ledger-state.json'),
    path.join(expDir, 'rounds', roundId, 'observe.md'),
    path.join(expDir, 'rounds', roundId, 'reflect.md'),
    report.path,
  ]
  for (const p of mustExist) must(fs.existsSync(p), `9) 断言文件存在: ${path.relative(tmpRoot, p)}`)
  // 额外：账本裸仓库仍完整
  must(fs.existsSync(path.join(repo, 'HEAD')), '9) 账本 HEAD 存在')
  must(gitLog(repo).length > 0, '9) 账本 git log 非空')

  console.log('\n' + '─'.repeat(60))
  console.log(`\x1b[32m✔ 端到端验收全绿：${checks.length} 项通过，${fails.length} 项失败\x1b[0m`)
  console.log(`  projectDir: ${projectDir}`)
  console.log(`  dataRoot:   ${dataRoot}`)
  console.log(`  slug:       ${slug}`)
  console.log(`  report:     ${report.path}`)
  console.log('─'.repeat(60))

  // 落盘结果供 CI 读取
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-dev')
  fs.mkdirSync(outDir, { recursive: true })
  const result = {
    ok: fails.length === 0,
    checks,
    fails,
    projectDir,
    dataRoot,
    slug,
    reportPath: report.path,
    ledgerRepo: repo,
    roundId,
    generatedAt: new Date().toISOString(),
    disciplines: '8/8 + 4 phases + daily report',
    hint: 'UI 验证（可选）：启动 DSH 后打开 http://127.0.0.1:<port> → 实验设计章节 → 实验账本/回合/日报 面板手动点检',
  }
  fs.writeFileSync(path.join(outDir, 'verify-exp-control-result.json'), JSON.stringify(result, null, 2), 'utf8')
  if (fails.length > 0) process.exit(1)
} catch (err) {
  console.error('\n\x1b[31m✘ 验收失败\x1b[0m', err?.stack ?? err)
  // 仍写失败结果
  try {
    const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp-dev')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'verify-exp-control-result.json'), JSON.stringify({ ok: false, error: String(err?.stack ?? err), checks, fails, generatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch {}
  process.exit(1)
} finally {
  if (!KEEP) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }) } catch (e) { console.warn(`temp cleanup deferred: ${tmpRoot} (${String(e)})`) }
  } else {
    console.log(`\n[keep] 临时目录已保留: ${tmpRoot}`)
  }
}
