// §12.3 验证：profileContextText 注入逻辑（全文/超限清单）+ 文件内容
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = process.argv[2]
const PROFILE_DIR = join(DATA_ROOT, '.evoresearch-data', 'memories', 'profile')

const { MemoryRuntime } = await import(pathToFileURL(join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'host', 'memory', 'index.js')).href)

mkdirSync(PROFILE_DIR, { recursive: true })
writeFileSync(join(PROFILE_DIR, 'SOUL.md'), '# SOUL\n\n保持严谨的科研风格，优先中文。', 'utf8')
writeFileSync(join(PROFILE_DIR, 'USER_PROFILE.md'), '# USER_PROFILE\n\n用户偏好简洁、实证。', 'utf8')

const rt = new MemoryRuntime({ dataRoot: DATA_ROOT })
rt['lastActiveSessionId'] = 'session-inject-test'

const report = {}
const text = rt.profileContextText()
report.fullInjection = {
  hasWrapper: text.includes('<identity_profile>') && text.includes('</identity_profile>'),
  hasSoul: text.includes('## SOUL.md') && text.includes('保持严谨的科研风格'),
  hasUser: text.includes('## USER_PROFILE.md') && text.includes('偏好简洁'),
}
report.fullLen = text.length

// 超限场景：写一个大文件（>24000 字符）→ 应只给清单
writeFileSync(join(PROFILE_DIR, 'BIG.md'), 'x'.repeat(30000), 'utf8')
const over = rt.profileContextText()
report.overLimit = {
  hasListing: over.includes('按需读取') && over.includes('BIG.md'),
  notFullBody: !over.includes('xxx'),
  hasSoulListing: over.includes('SOUL.md'),
}
rmSync(join(PROFILE_DIR, 'BIG.md'), { force: true })

// 空目录 → 空串
rmSync(join(PROFILE_DIR, 'SOUL.md'), { force: true })
rmSync(join(PROFILE_DIR, 'USER_PROFILE.md'), { force: true })
report.empty = rt.profileContextText() === ''

// 自动计数断言（BASE-02/t22 约定：pass/total 跟随实际 check() 调用数；
// 断言与报告保持一致，避免只生成报告而漏掉失败。
let pass = 0
let total = 0
const check = (name, cond, detail = '') => {
  total += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (cond) pass += 1
}
check('全文注入：identity_profile 包裹', report.fullInjection.hasWrapper === true)
check('全文注入：SOUL.md 内容', report.fullInjection.hasSoul === true)
check('全文注入：USER_PROFILE.md 内容', report.fullInjection.hasUser === true)
check('超限：只给清单含按需读取', report.overLimit.hasListing === true)
check('超限：不含大文件正文', report.overLimit.notFullBody === true)
check('超限：清单含 SOUL.md 入口', report.overLimit.hasSoulListing === true)
check('空目录：注入为空串', report.empty === true)
console.log(`\n${pass}/${total} passed`)
process.exit(pass === total ? 0 : 1)
