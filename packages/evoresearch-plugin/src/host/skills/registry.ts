/**
 * 分层 Skill 注册表（PLAT-08/09/10）。
 *
 * PLAT-08：builtin / global / workspace / project / custom 五层；
 * - 同名优先级（高层覆盖低层）：custom > project > workspace > global > builtin；
 * - 注册（写入层目录）、按需读取 body（读 SKILL.md）、变更监听（fs.watchFile
 *   mtime，返回 disposer）、失效重建（watch 回调 + get 重新扫描）、卸载
 *   （uninstall 后自动回退到下一层同名技能 = 安全回退）；
 * - 对接 DSH：registerDshProvider(ctx) 把五层聚合为一个 SkillProvider 注册进
 *   ctx.skills（返回 disposer；DSH 端"最近层胜出"语义与本层优先级一致）。
 *
 * PLAT-09：本地路径与 Git 仓库安装——来源记录（source.json：kind/url/commit/
 * localPath/version/installedAt/文件清单）、卸载与安全回退（回退到低层同名）。
 *
 * PLAT-10：AGENTS.md 或等价自然语言专家说明——readScope() 优先读 SKILL.md
 * frontmatter 的 scope 字段，其次读 <skillDir>/AGENTS.md 首段；暴露适用范围
 * 声明，供 RA/EA/EMA（science/roles.ts）与 ExpertService 判断何时调用。
 *
 * 目录布局（每层一个根，技能 = <root>/<name>/SKILL.md [+AGENTS.md] [+source.json]）：
 * - builtin:  <dataRoot>/.evoresearch-data/skills/builtin/
 * - global:   <dataRoot>/skills/            （与 autoskills 的 skillsDir 对齐，
 *             host/index.ts 即传 path.join(dataRoot, 'skills')）
 * - workspace: <workspaceDir>/skills/       （用户可见，随工作区迁移）
 * - project:  <workspaceDir>/.evoresearch-data/skills/
 * - custom:   <dataRoot>/.evoresearch-data/skills/custom/
 *
 * 所有动态注册（watch/provider）返回 disposer；disposeAll() 在插件卸载时释放
 * 全部监听与 DSH provider 注册（PLAT-21 卸载无副作用）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'

/** 技能层（PLAT-08：五层）。 */
export type SkillLayer = 'builtin' | 'global' | 'workspace' | 'project' | 'custom'

/** 层优先级（索引越小优先级越高；同名时高层覆盖低层）。 */
export const SKILL_LAYER_PRIORITY: readonly SkillLayer[] = ['custom', 'project', 'workspace', 'global', 'builtin']

/** 来源记录（PLAT-09）。 */
export interface SkillSource {
  readonly kind: 'local' | 'git'
  /** local：来源目录绝对路径。 */
  readonly localPath?: string
  /** git：仓库 URL。 */
  readonly url?: string
  /** git：安装时 commit（短 hash）。 */
  readonly commit?: string
  /** 来源版本（git=commit 短 hash；local='local'）。 */
  readonly version: string
  readonly installedAt: number
  /** 安装文件清单（相对技能目录；缺省 = 目录全部文件）。 */
  readonly files?: readonly string[]
}

/** 一条已装载技能（含层与来源）。 */
export interface SkillEntry {
  readonly name: string
  readonly layer: SkillLayer
  readonly description: string
  /** 适用范围声明（PLAT-10；SKILL.md frontmatter scope 或 AGENTS.md）。 */
  readonly scope?: string
  /** SKILL.md 绝对路径。 */
  readonly bodyPath: string
  /** 技能目录绝对路径。 */
  readonly dir: string
  readonly source: SkillSource | null
  readonly version: string
  /** 最后修改时间（mtime，ms；变更监听用）。 */
  readonly updatedAt: number
}

/** 注册输入（register：写入层目录）。 */
export interface SkillRegisterInput {
  readonly name: string
  readonly description?: string
  /** Markdown 正文（写 SKILL.md）。 */
  readonly body: string
  /** 适用范围声明（写 frontmatter scope 或 AGENTS.md，PLAT-10）。 */
  readonly scope?: string
  /** 安装来源（PLAT-09；register 生成的来源）。 */
  readonly source?: SkillSource
}

/** git 执行注入（测试用；缺省 execFile('git')）。 */
export type GitRunner = (args: readonly string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr?: string }>

/** 默认 git 执行：execFile('git', args, { cwd, windowsHide: true })。 */
export function defaultGitRunner(args: readonly string[], cwd?: string): Promise<{ code: number; stdout: string; stderr?: string }> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        resolve({ code: typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1, stdout: '', stderr: String(stderr ?? error.message) })
      } else {
        resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    })
  })
}

export interface SkillRegistryOptions {
  readonly dataRoot: string
  /** 当前工作区（workspace/project 层基准；缺省 = dataRoot）。 */
  readonly workspaceDir?: string
  /** git 执行注入（测试）。 */
  readonly git?: GitRunner
}

/** 技能名安全段（防路径穿越）。 */
function safeSkillName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '')
  if (safe === '' || safe === '.' || safe === '..') throw new Error(`非法技能名: ${name}`)
  return safe
}

/** 解析 SKILL.md 的 YAML frontmatter（name/description/scope；容忍缺失）。 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string; scope?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!match) return { body: content }
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]!] = kv[2]!.trim()
  }
  return {
    name: fields['name'],
    description: fields['description'],
    scope: fields['scope'],
    body: content.slice(match[0].length),
  }
}

/** 分层 Skill 注册表。 */
export class LayeredSkillRegistry {
  private readonly options: SkillRegistryOptions
  private readonly watchers = new Map<string, () => void>()
  private readonly dshProviderDisposers: Array<() => void> = []
  private readonly git: GitRunner

  constructor(options: SkillRegistryOptions) {
    this.options = options
    this.git = options.git ?? defaultGitRunner
  }

  /** 层根目录（workspace/project 层依赖 workspaceDir）。 */
  layerDir(layer: SkillLayer, workspaceDir?: string): string {
    const ws = workspaceDir ?? this.options.workspaceDir ?? this.options.dataRoot
    switch (layer) {
      case 'builtin':
        return path.join(this.options.dataRoot, '.evoresearch-data', 'skills', 'builtin')
      case 'global':
        return path.join(this.options.dataRoot, 'skills')
      case 'workspace':
        return path.join(ws, 'skills')
      case 'project':
        return path.join(ws, '.evoresearch-data', 'skills')
      case 'custom':
        return path.join(this.options.dataRoot, '.evoresearch-data', 'skills', 'custom')
    }
  }

  /**
   * workspace 层是否启用：必须显式指定 workspaceDir 且不是部署根
   * （否则与 global 层 <dataRoot>/skills/ 同目录，会造成层归属歧义）。
   */
  private workspaceLayerEnabled(workspaceDir?: string): boolean {
    const ws = workspaceDir ?? this.options.workspaceDir
    return ws !== undefined && ws !== this.options.dataRoot
  }

  /** 技能目录：<layerRoot>/<name>/。 */
  private skillDir(layer: SkillLayer, name: string): string {
    return path.join(this.layerDir(layer), safeSkillName(name))
  }

  /** 扫描层内全部技能（目录含 SKILL.md 的才算）。 */
  list(layer?: SkillLayer): SkillEntry[] {
    const layers: SkillLayer[] = layer ? [layer] : [...SKILL_LAYER_PRIORITY]
    const entries: SkillEntry[] = []
    for (const current of layers) {
      if (current === 'workspace' && !this.workspaceLayerEnabled()) continue
      const root = this.layerDir(current)
      let names: string[] = []
      try {
        names = fs.readdirSync(root).filter((name) => {
          try {
            return fs.statSync(path.join(root, name)).isDirectory()
          } catch {
            return false
          }
        })
      } catch {
        continue
      }
      for (const name of names) {
        const entry = this.entryOf(current, name)
        if (entry) entries.push(entry)
      }
    }
    return entries
  }

  /** 读单条（精确层；无则 undefined）。 */
  get(name: string, layer?: SkillLayer): SkillEntry | undefined {
    if (layer) return this.entryOf(layer, name)
    return this.resolve(name)
  }

  /** 按优先级解析（PLAT-08：高层覆盖低层；找不到返回 undefined）。 */
  resolve(name: string): SkillEntry | undefined {
    for (const layer of SKILL_LAYER_PRIORITY) {
      const entry = this.entryOf(layer, name)
      if (entry) return entry
    }
    return undefined
  }

  private entryOf(layer: SkillLayer, name: string): SkillEntry | undefined {
    if (layer === 'workspace' && !this.workspaceLayerEnabled()) return undefined
    const dir = this.skillDir(layer, name)
    const bodyPath = path.join(dir, 'SKILL.md')
    let content: string
    try {
      content = fs.readFileSync(bodyPath, 'utf8')
    } catch {
      return undefined
    }
    const frontmatter = parseSkillFrontmatter(content)
    const source = this.readSource(dir)
    let updatedAt = 0
    try {
      updatedAt = fs.statSync(bodyPath).mtimeMs
    } catch {
      updatedAt = 0
    }
    return {
      name,
      layer,
      description: frontmatter.description ?? frontmatter.name ?? name,
      scope: frontmatter.scope ?? this.readAgentsScope(dir),
      bodyPath,
      dir,
      source,
      version: source?.version ?? 'local',
      updatedAt,
    }
  }

  /** AGENTS.md 适用范围声明（PLAT-10：优先 SKILL.md frontmatter scope，其次 AGENTS.md 首段）。 */
  private readAgentsScope(dir: string): string | undefined {
    const agentsPath = path.join(dir, 'AGENTS.md')
    try {
      const lines = fs.readFileSync(agentsPath, 'utf8').split(/\r?\n/)
      // 找含「适用范围」关键词的行；标题行（# 开头）取下一行非空内容。
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!.trim()
        if (line === '') continue
        if (/适用范围|scope|适用场景|when to use/i.test(line)) {
          if (/^#{1,6}\s+/.test(line)) {
            const next = lines.slice(index + 1).find((l) => l.trim() !== '')
            if (next) return next.trim().slice(0, 300)
            return undefined
          }
          return line.slice(0, 300)
        }
      }
      // 无关键词：取首段（首个空行前）作范围说明。
      const head = lines.join('\n').trim().split(/\n\s*\n/)[0]
      return head && head.length > 0 ? head.slice(0, 300) : undefined
    } catch {
      return undefined
    }
  }

  private readSource(dir: string): SkillSource | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8')) as SkillSource
      if (raw && typeof raw === 'object' && (raw.kind === 'local' || raw.kind === 'git')) return raw
      return null
    } catch {
      return null
    }
  }

  /** 按需读取 body（SKILL.md 全文；PLAT-08）。 */
  readBody(name: string, layer?: SkillLayer): string | undefined {
    const entry = layer ? this.entryOf(layer, name) : this.resolve(name)
    if (!entry) return undefined
    try {
      return fs.readFileSync(entry.bodyPath, 'utf8')
    } catch {
      return undefined
    }
  }

  /** 适用范围声明（PLAT-10）。 */
  readScope(name: string, layer?: SkillLayer): string | undefined {
    const entry = layer ? this.entryOf(layer, name) : this.resolve(name)
    return entry?.scope
  }

  /** 注册技能（PLAT-08：写入层目录；可带来源记录）。 */
  register(layer: SkillLayer, input: SkillRegisterInput): SkillEntry {
    if (layer === 'workspace' && !this.workspaceLayerEnabled()) {
      throw new Error('workspace 层需要显式 workspaceDir（且不能等于部署根）')
    }
    const name = safeSkillName(input.name)
    const dir = this.skillDir(layer, input.name)
    fs.mkdirSync(dir, { recursive: true })
    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${(input.description ?? '').replace(/\n+/g, ' ').slice(0, 1024)}`,
      ...(input.scope ? [`scope: ${input.scope.replace(/\n+/g, ' ').slice(0, 1024)}`] : []),
      '---',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `${frontmatter}${input.body.trim()}\n`, 'utf8')
    if (input.source) this.writeSource(dir, input.source)
    else if (fs.existsSync(path.join(dir, 'source.json'))) fs.rmSync(path.join(dir, 'source.json'), { force: true })
    const entry = this.entryOf(layer, name)
    if (!entry) throw new Error(`技能注册后不可读: ${name}`)
    return entry
  }

  private writeSource(dir: string, source: SkillSource): void {
    fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(source, null, 2), 'utf8')
  }

  /* ── PLAT-09：本地路径与 Git 仓库安装 ────────────────────────────────── */

  /** 从本地路径安装（复制目录进层目录；跳过 .git/venv 等可重建目录）。 */
  installFromLocal(layer: SkillLayer, localPath: string, opts: { name?: string } = {}): SkillEntry {
    const abs = path.resolve(localPath)
    if (!fs.existsSync(path.join(abs, 'SKILL.md'))) {
      throw new Error(`本地技能目录缺少 SKILL.md: ${abs}`)
    }
    const name = safeSkillName(opts.name ?? path.basename(abs))
    const target = this.skillDir(layer, name)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    copyDirSkip(abs, target, new Set(['.git', '.venv', 'node_modules', '__pycache__', '.pytest_cache']))
    const files = listFilesRelative(target)
    const source: SkillSource = { kind: 'local', localPath: abs, version: 'local', installedAt: Date.now(), files }
    this.writeSource(target, source)
    const entry = this.entryOf(layer, name)
    if (!entry) throw new Error(`本地安装后不可读: ${name}`)
    return entry
  }

  /** 从 Git 仓库安装（clone 到层目录 + 记录 commit/文件清单；注入 git runner）。 */
  async installFromGit(layer: SkillLayer, url: string, opts: { ref?: string; name?: string } = {}): Promise<SkillEntry> {
    const name = safeSkillName(opts.name ?? repoNameOf(url))
    const target = this.skillDir(layer, name)
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const cloneArgs = ['clone', '--depth', '1', ...(opts.ref ? ['--branch', opts.ref] : []), url, target]
    const clone = await this.git(cloneArgs)
    if (clone.code !== 0) {
      fs.rmSync(target, { recursive: true, force: true })
      throw new Error(`git clone 失败（${clone.code}）: ${clone.stderr ?? clone.stdout}`)
    }
    const rev = await this.git(['-C', target, 'rev-parse', 'HEAD'])
    const commit = rev.code === 0 ? rev.stdout.trim().slice(0, 12) : 'unknown'
    if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
      fs.rmSync(target, { recursive: true, force: true })
      throw new Error(`Git 仓库缺少 SKILL.md（不是技能仓库）: ${url}`)
    }
    const files = listFilesRelative(target)
    this.writeSource(target, { kind: 'git', url, commit, version: commit, installedAt: Date.now(), files })
    const entry = this.entryOf(layer, name)
    if (!entry) throw new Error(`Git 安装后不可读: ${name}`)
    return entry
  }

  /** 卸载（PLAT-08/09：删除层内目录；返回回退到下一层同名技能的安全回退结果）。 */
  uninstall(name: string, layer: SkillLayer): { ok: boolean; fallback?: SkillEntry } {
    const dir = this.skillDir(layer, name)
    if (!fs.existsSync(dir)) return { ok: false }
    // 只删除本技能目录（不触碰任何科研资料；PLAT-21）。
    fs.rmSync(dir, { recursive: true, force: true })
    const fallback = this.resolve(name)
    return { ok: true, fallback }
  }

  /** 来源记录（各层同名技能的来源；PLAT-09）。 */
  sources(name: string): SkillSource[] {
    const result: SkillSource[] = []
    for (const layer of SKILL_LAYER_PRIORITY) {
      const entry = this.entryOf(layer, name)
      if (entry?.source) result.push(entry.source)
    }
    return result
  }

  /** 变更监听（PLAT-08：mtime 变化 → callback；返回 disposer）。 */
  watch(name: string, callback: (entry: SkillEntry) => void, layer?: SkillLayer): () => void {
    const entry = layer ? this.entryOf(layer, name) : this.resolve(name)
    if (!entry) {
      callback(entry as never) // 不存在时回调一次（undefined），由调用方决定
      return () => {}
    }
    const key = `${entry.layer}:${entry.name}`
    const listener = (): void => {
      const current = this.entryOf(entry.layer, name)
      if (current) callback(current)
    }
    fs.watchFile(entry.bodyPath, { interval: 200 }, listener)
    const disposer = () => {
      fs.unwatchFile(entry.bodyPath, listener)
      this.watchers.delete(key)
    }
    this.watchers.set(key, disposer)
    return disposer
  }

  /* ── PLAT-08：对接 DSH ctx.skills（SkillProvider 形状） ──────────────── */

  /**
   * 把五层聚合注册为 DSH SkillProvider（ctx.skills.registerProvider）。
   * 返回 disposer；DSH 端技能名冲突时本层优先级（custom 最高）生效。
   */
  registerDshProvider(ctx: { get(name: string): unknown }): () => void {
    const skills = ctx.get('skills') as
      | { registerProvider?(create: (control: unknown) => unknown): () => void }
      | undefined
    if (!skills || typeof skills.registerProvider !== 'function') {
      // DSH 注册表不可用：本地注册表仍可用（EvoResearch 自管），记录降级。
      console.warn('[evoresearch:skills] DSH ctx.skills 不可用，分层注册表独立运行（技能对 DSH 模型不可见）')
      return () => {}
    }
    const providerName = 'evoresearch-layered'
    const provider = {
      name: providerName,
      list: async () => {
        const candidates = this.list().map((entry) => ({
          name: entry.name,
          description: entry.description,
          whenToUse: entry.scope,
          rank: SKILL_LAYER_PRIORITY.indexOf(entry.layer),
          provider: providerName,
          locator: { layer: entry.layer, name: entry.name },
          path: entry.bodyPath,
          metadata: entry.scope ? { scope: entry.scope } : undefined,
        }))
        return { candidates, complete: true }
      },
      get: async (candidate: { locator?: { layer?: SkillLayer; name?: string } }) => {
        const locator = candidate?.locator as { layer?: SkillLayer; name?: string } | undefined
        if (!locator?.layer || !locator?.name) return undefined
        const body = this.readBody(locator.name, locator.layer)
        if (body === undefined) return undefined
        const entry = this.entryOf(locator.layer, locator.name)
        return {
          name: locator.name,
          description: entry?.description ?? '',
          content: body,
          path: entry?.bodyPath,
          provider: providerName,
        }
      },
    }
    const disposer = skills.registerProvider(() => provider)
    this.dshProviderDisposers.push(disposer)
    return () => {
      disposer()
      const index = this.dshProviderDisposers.indexOf(disposer)
      if (index >= 0) this.dshProviderDisposers.splice(index, 1)
    }
  }

  /** 插件卸载：释放全部监听与 DSH provider 注册（PLAT-21 无副作用）。 */
  disposeAll(): void {
    for (const disposer of [...this.watchers.values()]) {
      try {
        disposer()
      } catch (error) {
        console.warn(`[evoresearch:skills] 释放监听失败: ${String(error)}`)
      }
    }
    this.watchers.clear()
    for (const disposer of [...this.dshProviderDisposers]) {
      try {
        disposer()
      } catch (error) {
        console.warn(`[evoresearch:skills] 释放 DSH provider 失败: ${String(error)}`)
      }
    }
    this.dshProviderDisposers.length = 0
  }
}

/** 从 git URL 推断技能名（owner/repo → repo 名）。 */
function repoNameOf(url: string): string {
  const cleaned = url.replace(/\.git$/, '')
  const parts = cleaned.split(/[/\\:]/).filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? 'skill'
}

/** 复制目录（跳过指定子目录；保留 source.json 语义由调用方写）。 */
function copyDirSkip(src: string, dest: string, skip: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    if (skip.has(name)) continue
    const from = path.join(src, name)
    const to = path.join(dest, name)
    const stat = fs.statSync(from)
    if (stat.isDirectory()) copyDirSkip(from, to, skip)
    else if (stat.isFile()) fs.copyFileSync(from, to)
  }
}

/** 相对文件清单（正斜杠；含 SKILL.md 等）。 */
function listFilesRelative(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string, rel: string): void => {
    let names: string[] = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(dir, name)
      const relPath = rel === '' ? name : `${rel}/${name}`
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(full, relPath)
      else if (stat.isFile()) files.push(relPath)
    }
  }
  walk(root, '')
  return files.sort()
}
