/**
 * 实验环境/配置指纹（可复现）——A.7
 *
 * 在账本初始化时写入实验工作区根目录下 provenance.json，记录：
 * app version / dsh version / node / os / dataRoot / model / config
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface Provenance {
  app: { name: string; version: string }
  dsh: { version: string }
  node: string
  model?: { provider: string; model: string }
  os: string
  dataRoot: string
  createdAt: number
  config: Record<string, unknown>
}

/** 生成并写入 provenance.json（幂等；已存在不覆盖除非 overwrite）。 */
export function captureProvenance(opts: {
  dataRoot: string
  projectDir: string
  slug: string
  overwrite?: boolean
}): Provenance {
  const expDir = path.join(path.resolve(opts.projectDir), 'experiments', opts.slug)
  fs.mkdirSync(expDir, { recursive: true })
  const file = path.join(expDir, 'provenance.json')
  if (fs.existsSync(file) && opts.overwrite !== true) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Provenance
    } catch { /* 损坏则重写 */ }
  }

  let appVersion = '0.1.0'
  const versionCandidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(path.resolve(opts.dataRoot), 'package.json'),
    path.join(process.cwd(), 'packages', 'evoresearch-plugin', 'package.json'),
    path.join(path.join(path.resolve(opts.projectDir), 'package.json')),
  ]
  for (const cand of versionCandidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(cand, 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string' && pkg.version !== '') { appVersion = pkg.version; break }
    } catch { /* try next */ }
  }

  let dshVersion = 'unknown'
  const dshCandidates = [
    path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'),
    path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'),
    path.join(path.resolve(opts.dataRoot, '..'), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(path.resolve(opts.dataRoot, '..'), 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'),
    path.join(path.resolve(opts.dataRoot), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(path.resolve(opts.dataRoot), 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'),
  ]
  for (const cand of dshCandidates) {
    try {
      const dshPkg = JSON.parse(fs.readFileSync(cand, 'utf8')) as { version?: string }
      if (typeof dshPkg.version === 'string' && dshPkg.version !== '') { dshVersion = dshPkg.version; break }
    } catch { /* try next */ }
  }

  // 尝试读取 model-settings.json 的当前选择与配置钉住信息
  let model: { provider: string; model: string } | undefined
  let config: Record<string, unknown> = {}
  try {
    const settingsFile = path.join(opts.dataRoot, 'plugins', 'model-settings.json')
    const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    const code = raw.code as Record<string, { provider?: string; model?: string; reasoningEffort?: string }> | undefined
    if (code !== undefined) {
      const tier = (raw.defaultTier as string | undefined) ?? 'medium'
      const selected = code[tier as keyof typeof code]
      if (selected?.provider && selected?.model) model = { provider: selected.provider, model: selected.model }
    }
    // 同时尝试读取 evoresearch 段的 memoryTokenBudget / auxiliaryModel（若存在）
    let memoryTokenBudget = (raw as { memoryTokenBudget?: unknown }).memoryTokenBudget
    let auxiliaryModel = (raw as { auxiliaryModel?: unknown }).auxiliaryModel
    try {
      const evoresearchSettings = path.join(opts.dataRoot, 'plugins', 'settings.yaml')
      if (memoryTokenBudget === undefined || auxiliaryModel === undefined) {
        const yaml = fs.readFileSync(evoresearchSettings, 'utf8')
        const m = yaml.match(/memoryTokenBudget:\s*(\d+)/)
        if (m !== null && memoryTokenBudget === undefined) memoryTokenBudget = Number(m[1])
      }
    } catch { /* ignore yaml */ }
    config = {
      ...(memoryTokenBudget !== undefined ? { memoryTokenBudget } : {}),
      ...(auxiliaryModel !== undefined ? { auxiliaryModel } : {}),
      ...(code !== undefined ? { code } : {}),
    }
    // 若 config 仍为空，保留至少一个空对象以满足 schema
    if (Object.keys(config).length === 0) config = { memoryTokenBudget: undefined, code: code ?? undefined }
  } catch { /* 无配置 */ }

  const provenance: Provenance = {
    app: { name: 'EvoResearch', version: appVersion },
    dsh: { version: dshVersion },
    node: process.version,
    ...(model ? { model } : {}),
    os: `${process.platform} ${process.arch}`,
    dataRoot: opts.dataRoot,
    createdAt: Date.now(),
    config,
  }

  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(provenance, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return provenance
}

/** 别名：capture() 供任务/文档描述使用的短名，行为同 captureProvenance。 */
export const capture = captureProvenance

/** 读取已有的 provenance.json（不存在返回 null）。 */
export function readProvenance(projectDir: string, slug: string): Provenance | null {
  const file = path.join(path.resolve(projectDir), 'experiments', slug, 'provenance.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Provenance
  } catch {
    return null
  }
}
