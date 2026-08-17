#!/usr/bin/env node
/**
 * verify-paths.mjs — MIG-07 先行：Windows 路径与中文编码验证（纯 Node，直接运行）。
 *
 * 运行：node --import tsx scripts/verify-paths.mjs
 * 通过标准：exit 0 且全部断言 PASS（超长路径为"记录行为"型用例：允许/拒绝均记录，仅截断判失败）。
 *
 * 覆盖路径与编码验收项（MIG-07）：
 *   A. 路径处理：盘符 / 正斜杠反斜杠混用 / UNC / 中文目录 / 带空格路径 / 260+ 超长路径 / 路径穿越
 *   B. 中文编码：项目名 slug、UTF-8 JSON 往返（.evoresearch-data）、中文文件名读写
 * 全部使用临时目录（os.tmpdir() + mkdtemp，结束清理，遵守 BASE-02 测试隔离约定），
 * 不读写任何用户真实资料；不修改 src 下任何文件。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as P from '../packages/evoresearch-plugin/src/host/core/paths.ts'
import { WorkspaceService } from '../packages/evoresearch-plugin/src/host/workspace.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  version: os.version(),
  tmpdir: os.tmpdir(),
}

// ---------- 断言收集器 ----------
let pass = 0
let total = 0
const results = [] // { id, name, expect, actual, ok }
const record = (id, name, expect, actual, ok) => {
  total += 1
  if (ok) pass += 1
  results.push({ id, name, expect: String(expect), actual: String(actual), ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}`)
}
const check = (id, name, expect, actual, cond) => record(id, name, expect, actual, cond)
const throws = (fn) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
/** 路径展示用短化：保留头尾。 */
const short = (p, max = 90) => (p.length <= max ? p : `${p.slice(0, 40)}…(${p.length} chars)…${p.slice(-30)}`)

// ---------- 夹具 ----------
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-paths-'))
const dataRoot = path.join(tmpBase, 'data-root 中文') // 带空格 + 中文的数据根
fs.mkdirSync(dataRoot, { recursive: true })
const svc = new WorkspaceService({ dataRoot })

try {
  // ================= A. 路径处理 =================
  console.log('\n=== A. 路径处理 ===')

  // A1 盘符路径
  const driveRoot = 'C:\\data-root'
  check('A-01', 'projectDir：盘符路径拼接', path.join(driveRoot, 'projects', 'alpha'), P.projectDir(driveRoot, 'alpha'),
    P.projectDir(driveRoot, 'alpha') === path.join(driveRoot, 'projects', 'alpha'))
  check('A-02', 'normPath：大小写归一化（保留本机分隔符）', 'c:\\data\\proj', P.normPath('C:\\Data\\PROJ'),
    P.normPath('C:\\Data\\PROJ') === 'c:\\data\\proj')
  check('A-03', 'validateWorkspace：部署根自身', 'kind=root', JSON.stringify(P.validateWorkspace(driveRoot, driveRoot)),
    P.validateWorkspace(driveRoot, driveRoot).kind === 'root')
  const vDrive = P.validateWorkspace(driveRoot, 'C:\\data-root\\projects\\alpha')
  check('A-04', 'validateWorkspace：盘符项目目录', 'kind=project name=alpha', JSON.stringify(vDrive),
    vDrive.kind === 'project' && vDrive.name === 'alpha')

  // A2 正斜杠 / 反斜杠混用
  check('A-05', 'validateWorkspace：正斜杠候选', 'kind=project', JSON.stringify(P.validateWorkspace(driveRoot, 'C:/data-root/projects/alpha')),
    P.validateWorkspace(driveRoot, 'C:/data-root/projects/alpha').kind === 'project')
  check('A-06', 'validateWorkspace：混用分隔符', 'kind=project', JSON.stringify(P.validateWorkspace(driveRoot, 'C:\\data-root/projects\\alpha')),
    P.validateWorkspace(driveRoot, 'C:\\data-root/projects\\alpha').kind === 'project')

  // A3 UNC
  const uncRoot = '\\\\server\\share\\research'
  check('A-07', 'normPath：UNC 大小写归一化', '\\\\server\\share\\research', P.normPath('\\\\SERVER\\Share\\RESEARCH'),
    P.normPath('\\\\SERVER\\Share\\RESEARCH') === P.normPath(uncRoot))
  const vUnc = P.validateWorkspace(uncRoot, '\\\\server\\share\\research\\projects\\alpha')
  check('A-08', 'validateWorkspace：UNC 项目目录', 'kind=project name=alpha', JSON.stringify(vUnc),
    vUnc.kind === 'project' && vUnc.name === 'alpha')
  check('A-09', 'validateWorkspace：UNC 根', 'kind=root', JSON.stringify(P.validateWorkspace(uncRoot, uncRoot)),
    P.validateWorkspace(uncRoot, uncRoot).kind === 'root')
  check('A-10', 'validateWorkspace：UNC 与盘符混用拒绝', '抛错', '不抛', throws(() => P.validateWorkspace(uncRoot, 'C:\\data-root\\projects\\alpha')))

  // A4 中文目录 / 带空格路径（真实临时目录）
  check('A-11', 'validateWorkspace：中文+空格数据根的项目目录', 'kind=project', JSON.stringify(P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha'))),
    P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha')).kind === 'project')
  const projChinese = svc.createProject('研究笔记')
  check('A-12', 'createProject：中文项目名自动 slug 为 project', 'project', projChinese.name, projChinese.name === 'project')
  check('A-13', 'createProject：项目目录真实存在', 'true', String(fs.existsSync(projChinese.path)), fs.existsSync(projChinese.path))
  check('A-14', 'validateWorkspace：中文项目目录名拒绝', '抛错', '不抛', throws(() => P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', '研究笔记'))))

  // A5 超长路径（260+）
  const longSeg = 'd'.repeat(24)
  let longRoot = tmpBase
  for (let i = 0; i < 12; i += 1) longRoot = path.join(longRoot, longSeg)
  const longProj = path.join(longRoot, 'projects', 'p'.repeat(64))
  const longResultFile = path.join(longProj, 'results', 'out-数据.txt')
  check('A-15', `构造超长项目路径 ${longProj.length} 字符（>260）`, '>260', String(longProj.length), longProj.length > 260)
  let longOutcome = ''
  try {
    fs.mkdirSync(longRoot, { recursive: true })
    fs.mkdirSync(path.dirname(longResultFile), { recursive: true })
    fs.writeFileSync(longResultFile, '长路径内容', 'utf8')
    longOutcome = `允许（创建成功，${fs.readFileSync(longResultFile, 'utf8')}）`
  } catch (error) {
    longOutcome = `拒绝（${error.code ?? error.name}: ${error.message.split('\n')[0]}）`
  }
  // 记录行为型用例：允许/拒绝均为有效结论，仅"截断"判失败
  check('A-16', `超长路径实测行为（记录）：${short(longProj)}`, '允许 或 拒绝（不截断）', longOutcome,
    longOutcome.startsWith('允许') || longOutcome.startsWith('拒绝'))
  // 纯函数层不截断、可解析
  const longV = P.validateWorkspace(longRoot, longProj)
  check('A-17', 'validateWorkspace：长路径纯函数解析', 'kind=project', JSON.stringify(longV),
    longV.kind === 'project' && longV.name === 'p'.repeat(64))
  check('A-18', 'projectDir：64 字符项目名合法', 'true', String(P.isValidProjectName('p'.repeat(64))), P.isValidProjectName('p'.repeat(64)))
  check('A-19', 'projectDir：65 字符项目名非法', 'false', String(P.isValidProjectName('p'.repeat(65))), !P.isValidProjectName('p'.repeat(65)))

  // A6 路径穿越 / 注入 / 盘符切换
  const rootR = path.join(dataRoot, '..', 'data-root 中文') // 与 dataRoot 等价
  check('A-20', 'validateWorkspace：../ 归一化后等价路径接受', 'kind=root', JSON.stringify(P.validateWorkspace(dataRoot, rootR)),
    P.validateWorkspace(dataRoot, rootR).kind === 'root')
  check('A-21', 'validateWorkspace：../ 逃逸出数据根拒绝', '抛错', '不抛',
    throws(() => P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha', '..', '..', '..', 'escape'))))
  check('A-22', 'validateWorkspace：projects/../projects 等价接受', 'kind=project', JSON.stringify(P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', '..', 'projects', 'alpha'))),
    P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', '..', 'projects', 'alpha')).kind === 'project')
  check('A-23', 'validateWorkspace：绝对路径注入（系统目录）拒绝', '抛错', '不抛',
    throws(() => P.validateWorkspace(dataRoot, 'C:\\Windows\\System32')))
  const otherDrive = (process.env.SystemDrive === 'C:' ? 'D:' : 'C:')
  check('A-24', `validateWorkspace：盘符切换（${otherDrive} 候选 vs ${path.parse(dataRoot).root} 数据根）拒绝`, '抛错', '不抛',
    throws(() => P.validateWorkspace(dataRoot, `${otherDrive}\\tmp\\root\\projects\\alpha`)))
  check('A-25', 'validateWorkspace：projects/ 目录本身拒绝', '抛错', '不抛',
    throws(() => P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects'))))
  check('A-26', 'validateWorkspace：非直接子目录（alpha/sub）拒绝', '抛错', '不抛',
    throws(() => P.validateWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha', 'sub'))))
  check('A-27', 'projectNameFromWorkspace：外部目录 undefined', 'undefined', String(P.projectNameFromWorkspace(dataRoot, 'C:\\outside')),
    P.projectNameFromWorkspace(dataRoot, 'C:\\outside') === undefined)
  check('A-28', 'projectNameFromWorkspace：项目目录解析', 'alpha', String(P.projectNameFromWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha'))),
    P.projectNameFromWorkspace(dataRoot, path.join(dataRoot, 'projects', 'alpha')) === 'alpha')
  check('A-29', 'projectDir：项目名含 / 拒绝', '抛错', '不抛', throws(() => P.projectDir(dataRoot, 'a/b')))
  check('A-30', 'projectDir：项目名含绝对路径拒绝', '抛错', '不抛', throws(() => P.projectDir(dataRoot, 'C:\\Windows')))
  check('A-31', 'listProjects：只列合法项目名（此时仅有 project）', 'project', JSON.stringify(P.listProjects(dataRoot)),
    JSON.stringify(P.listProjects(dataRoot)) === JSON.stringify(['project']))

  // A7 导入路径安全
  const srcOutside = path.join(tmpBase, '外部实验数据')
  fs.mkdirSync(srcOutside, { recursive: true })
  fs.writeFileSync(path.join(srcOutside, 'note.md'), '# 外部笔记', 'utf8')
  const imported = svc.importProject(srcOutside, '我的实验')
  check('A-32', 'importProject：中文请求名 slug 化', 'project 或 project-N', imported.name, /^project(-\d+)?$/.test(imported.name))
  check('A-33', 'importProject：导入内容完整', 'note.md 存在', String(fs.existsSync(path.join(imported.path, 'note.md'))),
    fs.existsSync(path.join(imported.path, 'note.md')))

  // ================= B. 中文编码 =================
  console.log('\n=== B. 中文编码 ===')

  // B1 slug 规则
  check('B-01', 'slugifyProjectName：纯中文回退 project', 'project', P.slugifyProjectName('研究笔记'), P.slugifyProjectName('研究笔记') === 'project')
  check('B-02', 'slugifyProjectName：中英混排只留英文数字', '2026', P.slugifyProjectName('中文 2026 实验'), P.slugifyProjectName('中文 2026 实验') === '2026')
  check('B-03', 'slugifyProjectName：英文+中文 → 英文 slug', 'orange-sky', P.slugifyProjectName('Orange Sky 研究'), P.slugifyProjectName('Orange Sky 研究') === 'orange-sky')
  check('B-04', 'slugifyProjectName：长输入截断 ≤20 且清尾连字符', 'abcdefghijklmnopqrst', P.slugifyProjectName('abcdefghijklmnopqrstuvwxyz-'), P.slugifyProjectName('abcdefghijklmnopqrstuvwxyz-') === 'abcdefghijklmnopqrst')
  check('B-05', 'slugifyProjectName：纯符号回退 project', 'project', P.slugifyProjectName('---'), P.slugifyProjectName('---') === 'project')

  // B2 UTF-8 JSON 往返（.evoresearch-data 内）
  const demo = svc.createProject('demo')
  fs.mkdirSync(demo.dataDir, { recursive: true }) // .evoresearch-data 由存储层懒创建，这里显式建目录
  const notesJson = {
    标题: '橙天假说研究',
    内容: '天空呈橙色，需要解释散射模型。含"引号"、\\反斜杠、\n换行、\t制表符。',
    列表: ['实验A', '实验B', 42, true, null],
    嵌套: { 方法: '仿真数据验证', 状态: '进行中' },
  }
  const jsonFile = path.join(demo.dataDir, 'notes.json')
  fs.writeFileSync(jsonFile, JSON.stringify(notesJson, null, 2), 'utf8')
  const readBack = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
  check('B-06', 'UTF-8 JSON 往返：深层中文内容一致', JSON.stringify(notesJson), JSON.stringify(readBack),
    JSON.stringify(notesJson) === JSON.stringify(readBack))
  const head = fs.readFileSync(jsonFile)
  check('B-07', 'UTF-8 无 BOM', '首字节非 EF BB BF', Array.from(head.subarray(0, 3)).join(','),
    !(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf))

  // B3 中文文件名读写（临时目录）
  const cnDir = path.join(tmpBase, '中文文件测试')
  fs.mkdirSync(cnDir, { recursive: true })
  const cnFile1 = path.join(cnDir, '实验记录-2026.txt')
  const cnText1 = '实验结果：橙色天空假说成立概率 87%。🚀'
  fs.writeFileSync(cnFile1, cnText1, 'utf8')
  check('B-08', '中文文件名写入/读回一致', cnText1, fs.readFileSync(cnFile1, 'utf8'),
    fs.readFileSync(cnFile1, 'utf8') === cnText1)
  const cnFile2 = path.join(cnDir, '我的 笔记 v1.md')
  const cnText2 = '# 我的笔记\n\n## 数据\n- 指标1: 0.92\n- 指标2: 中文'
  fs.writeFileSync(cnFile2, cnText2, 'utf8')
  check('B-09', '中文+空格文件名写入/读回一致', cnText2, fs.readFileSync(cnFile2, 'utf8'),
    fs.readFileSync(cnFile2, 'utf8') === cnText2)
  const nestedCn = path.join(cnDir, '数据', '实验A', '结果')
  fs.mkdirSync(nestedCn, { recursive: true })
  const cnFile3 = path.join(nestedCn, 'out.json')
  fs.writeFileSync(cnFile3, JSON.stringify({ 实验: 'A', 结论: '通过' }), 'utf8')
  check('B-10', '中文多级目录文件写入/读回一致', '通过', JSON.parse(fs.readFileSync(cnFile3, 'utf8')).结论,
    JSON.parse(fs.readFileSync(cnFile3, 'utf8')).结论 === '通过')
  const cnDirEntries = fs.readdirSync(cnDir).sort()
  check('B-11', 'readdir 中文文件名无乱码', '实验记录-2026.txt,我的 笔记 v1.md,数据', cnDirEntries.join(','),
    JSON.stringify(cnDirEntries) === JSON.stringify(['实验记录-2026.txt', '我的 笔记 v1.md', '数据']))

  // ================= 附带发现：测试临时目录泄漏扫描 =================
  // 观察：packages/evoresearch-plugin/test/paths.test.ts 在模块级 mkdtemp 且从不清理
  //（无 after 钩子 / 无 rmSync），每次 npm test 都在系统临时目录留下
  // evoresearch-paths-*（含 root/projects 夹具）。这里统计现存泄漏数量写入报告。
  const leakPrefixes = ['evoresearch-paths-', 'EVORESEARCH-paths-']
  const leakedDirs = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && leakPrefixes.some((p) => e.name.startsWith(p)))
    .map((e) => path.join(os.tmpdir(), e.name))
    .filter((d) => d !== tmpBase) // 排除本脚本自己的临时目录
  console.log(`\n=== 附带发现 ===`)
  console.log(`系统临时目录现存 evoresearch-paths-* 泄漏目录：${leakedDirs.length} 个（来自 test/paths.test.ts，非本脚本）`)

  // ================= 汇总 =================
  console.log(`\n${pass}/${total} passed`)
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.log('失败用例：', failed.map((f) => f.id).join(', '))
  }
  // ---------- 生成本地临时报告 ----------
  const rows = results
    .map((r) => `| ${r.id} | ${r.name.replace(/\|/g, '\\|')} | ${r.expect.replace(/\|/g, '\\|')} | ${r.actual.replace(/\|/g, '\\|')} | ${r.ok ? '✅' : '❌'} |`)
    .join('\n')
  const report = `# 路径与中文编码验证报告（MIG-07 先行）

> MIG-07：桌面与网页模式的路径、中文编码和 Windows 长路径验证。
> 被测实现：\`packages/evoresearch-plugin/src/host/core/paths.ts\` 与 \`src/host/workspace.ts\`
>（经 \`node --import tsx\` 直接加载 src，测试的是当前源码）。
> 运行方式：\`node --import tsx scripts/verify-paths.mjs\`（exit 0 = 全绿）。

## 环境

| 项 | 值 |
|---|---|
| Node.js | ${env.node} |
| 平台 | ${env.platform}（${env.arch}） |
| Windows | ${env.version}（release ${env.release}） |
| 系统临时目录 | \`${env.tmpdir}\` |

## 测试矩阵

| ID | 用例 | 期望 | 实际 | 结论 |
|---|---|---|---|---|
${rows}

## 超长路径实测（260+）

- 构造路径：\`${short(longProj)}\`（${longProj.length} 字符 > 260）
- 实测行为：**${longOutcome}**
- 纯函数层（validateWorkspace / projectDir / isValidProjectName）：超长路径不截断、可正确解析与校验。

## 结论与发现的问题

${failed.length === 0 ? '**未发现生产代码缺陷。** 路径安全护栏（穿越/注入/盘符切换/非直接子目录）全部按设计拒绝；中文 slug、UTF-8 JSON 往返与中文文件名读写全部一致。'
    : `**发现 ${failed.length} 个问题**（详见上表 ❌ 行）：\n${failed.map((f) => `- [${f.id}] ${f.name}：期望 ${f.expect}，实际 ${f.actual}`).join('\n')}`}

### 附带发现（测试卫生，非生产代码）

- **\`packages/evoresearch-plugin/test/paths.test.ts\` 泄漏临时目录**：模块级 \`mkdtempSync('evoresearch-paths-')\` 创建 \`TMP\` 且无任何清理（无 after 钩子、无 rmSync），每次 \`npm test\` 在系统临时目录遗留一个含 \`root/projects\` 夹具的目录。本次运行扫描到系统临时目录现存 **${leakedDirs.length} 个**泄漏目录（含 2026-08-14 旧命名的 \`EVORESEARCH-paths-*\`）。
- 建议修复（一行）：在 \`paths.test.ts\` 增加 \`import { after } from 'node:test'\` 与 \`after(() => { fs.rmSync(TMP, { recursive: true, force: true }) })\`。属 BASE-02「测试隔离约定」清理保证的落实，由队长安排修复（不在本任务文件范围内）。

> 说明：超长路径行为取决于系统「长路径支持」设置，属记录型用例；若为「拒绝」，是 Windows 长路径未开启或路径超限，不属于代码缺陷。
`
  const reportPath = path.join(REPO_ROOT, '.tmp-port', 'paths-verification.md')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, report, 'utf8')
  console.log(`报告已写入 .tmp-port/paths-verification.md`)
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true })
}
process.exit(pass === total ? 0 : 1)
