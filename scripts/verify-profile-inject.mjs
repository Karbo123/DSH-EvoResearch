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

console.log(JSON.stringify(report, null, 1))
process.exit(0)
