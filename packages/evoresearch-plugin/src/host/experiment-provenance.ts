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
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    if (typeof pkg.version === 'string') appVersion = pkg.version
  } catch { /* ignore */ }

  let dshVersion = 'unknown'
  try {
    const dshPkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as { version?: string }
    if (typeof dshPkg.version === 'string') dshVersion = dshPkg.version
  } catch {
    try {
      const dshPkg2 = JSON.parse(fs.readFileSync(path.join(path.resolve(opts.dataRoot, '..'), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as { version?: string }
      if (typeof dshPkg2.version === 'string') dshVersion = dshPkg2.version
    } catch { /* ignore */ }
  }

  // 尝试读取 model-settings.json 的当前选择
  let model: { provider: string; model: string } | undefined
  let config: Record<string, unknown> = {}
  try {
    const settingsFile = path.join(opts.dataRoot, '.evoresearch-data', 'model-settings.json')
    const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    const code = raw.code as Record<string, { provider?: string; model?: string; reasoningEffort?: string }> | undefined
    if (code !== undefined) {
      const tier = (raw.defaultTier as string | undefined) ?? 'medium'
      const selected = code[tier as keyof typeof code]
      if (selected?.provider && selected?.model) model = { provider: selected.provider, model: selected.model }
    }
    config = {
      memoryTokenBudget: (raw as { memoryTokenBudget?: unknown }).memoryTokenBudget,
      code: code ?? undefined,
    }
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

/** 读取已有的 provenance.json（不存在返回 null）。 */
export function readProvenance(projectDir: string, slug: string): Provenance | null {
  const file = path.join(path.resolve(projectDir), 'experiments', slug, 'provenance.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Provenance
  } catch {
    return null
  }
}
