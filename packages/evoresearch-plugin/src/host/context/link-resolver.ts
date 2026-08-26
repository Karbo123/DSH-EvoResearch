/**
 * Bounded resolver for links written in Memory Markdown.
 *
 * Markdown and science-memory sidecars are navigation hints. The original
 * files remain authoritative; this module only returns safe locators and small
 * excerpts for the current context build.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { workspaceDataDir } from '../core/paths.js'

export type ResolvedLinkKind =
  | 'url' | 'chat' | 'note' | 'paper' | 'experiment' | 'run' | 'log'
  | 'file' | 'code' | 'latex' | 'result' | 'manuscript'

export interface ResolvedLink {
  readonly locator: string
  readonly kind: ResolvedLinkKind
  readonly label: string
  readonly target: string
  readonly source: 'markdown' | 'sidecar'
  readonly exists: boolean
  readonly searchHint: string
  readonly path?: string
}

export interface LinkTraceEntry {
  readonly sourceLocator: string
  readonly label: string
  readonly target: string
  readonly kind: ResolvedLinkKind
  readonly locator: string
  readonly opened: boolean
  readonly reason: string
}

export interface LinkResolverOptions {
  readonly workspaceDir?: string
  readonly sourceFile?: string
  readonly maxTargets?: number
  readonly sidecarKind?: string
}

/**
 * 有界链接遍历选项（CG-LINK-11/12）。
 *
 * depth=0 表示 Memory 正文，depth=1 是正文直接链接，depth=2 是链接资料
 * 再指向的资料。所有上限都是硬上限，避免坏链接或循环链接拖垮一轮上下文。
 */
export interface LinkTraversalOptions extends LinkResolverOptions {
  readonly maxDepth?: number
  readonly maxReads?: number
  readonly maxChars?: number
}

/** Memory → 原始资料的有界遍历结果。 */
export interface LinkTraversalResult {
  readonly text: string
  readonly links: readonly ResolvedLink[]
  readonly traces: readonly LinkTraceEntry[]
  readonly opened: number
  readonly truncated: boolean
}

interface SidecarLink { readonly label?: unknown; readonly target?: unknown; readonly kind?: unknown }

const MARKDOWN_LINK = /!?(?:\[([^\]]*)\])\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g
const BARE_URL = /https?:\/\/[^\s<>"')\]]+/gi
const INTERNAL_LINK = /(?:evoresearch:\/\/|(?:chat|session|note|paper|experiment|run|log|file|code|latex|result|manuscript):)[^\s<>"')\]]+/gi

function isInside(file: string, root: string): boolean {
  const target = path.resolve(file)
  const base = path.resolve(root)
  return target === base || target.startsWith(`${base}${path.sep}`)
}

function pathKind(file: string): ResolvedLinkKind {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return 'paper'
  if (ext === '.tex' || ext === '.bib') return 'latex'
  if (['.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.cpp', '.c', '.rs', '.go'].includes(ext)) return 'code'
  if (['.csv', '.json', '.jsonl', '.npy', '.npz', '.png', '.jpg', '.jpeg', '.svg'].includes(ext)) return 'result'
  if (['.log', '.err', '.out'].includes(ext)) return 'log'
  return 'file'
}

function stripAnchor(value: string): string { return value.replace(/[?#].*$/, '') }
function labelOf(label: string, target: string): string { return (label.trim() || target).slice(0, 160) }

export class LinkResolver {
  constructor(readonly dataRoot: string) {}

  /** Resolve inline Markdown, bare URLs, internal locators and safe paths. */
  resolveText(text: string, options: LinkResolverOptions = {}): ResolvedLink[] {
    const result: ResolvedLink[] = []
    const seen = new Set<string>()
    const add = (label: string, target: string, source: 'markdown' | 'sidecar'): void => {
      const link = this.resolveOne(label, target, source, options)
      if (link === undefined || seen.has(link.locator)) return
      seen.add(link.locator)
      result.push(link)
    }
    MARKDOWN_LINK.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MARKDOWN_LINK.exec(text)) !== null) add(match[1] ?? '', match[2] ?? '', 'markdown')
    BARE_URL.lastIndex = 0
    while ((match = BARE_URL.exec(text)) !== null) add(match[0] ?? '', match[0] ?? '', 'markdown')
    INTERNAL_LINK.lastIndex = 0
    while ((match = INTERNAL_LINK.exec(text)) !== null) add(match[0] ?? '', match[0] ?? '', 'markdown')
    return result.slice(0, options.maxTargets ?? 32)
  }

  /** Merge science/memory.ts .index.json links with inline links. */
  mergeSidecar(text: string, links: readonly SidecarLink[], options: LinkResolverOptions = {}): ResolvedLink[] {
    const result = this.resolveText(text, options)
    const seen = new Set(result.map((item) => item.locator))
    for (const sidecar of links) {
      if (typeof sidecar.target !== 'string' || sidecar.target.trim() === '') continue
      const link = this.resolveOne(
        typeof sidecar.label === 'string' ? sidecar.label : sidecar.target,
        sidecar.target,
        'sidecar',
        { ...options, sidecarKind: typeof sidecar.kind === 'string' ? sidecar.kind : undefined },
      )
      if (link === undefined || seen.has(link.locator)) continue
      seen.add(link.locator)
      result.push(link)
    }
    return result.slice(0, options.maxTargets ?? 32)
  }

  /**
   * 读取 Memory 链接的最多两跳局部原文（CG-LINK-05/06/11/12）。
   *
   * 该方法只返回小片段；完整资料始终留在原文件。visited 按规范 locator
   * 去重，同时以 source→target 边去重，因而 A→B→A、重复 sidecar 和同文
   * 多次链接都会在这里停止。失效链接仍保留 trace，调用方可继续做全项目搜索。
   */
  follow(text: string, sourceLocator: string, options: LinkTraversalOptions = {}): LinkTraversalResult {
    const maxDepth = Math.max(0, Math.min(8, Math.floor(options.maxDepth ?? 2)))
    const maxReads = Math.max(0, Math.min(64, Math.floor(options.maxReads ?? 6)))
    const maxChars = Math.max(1, Math.min(32_000, Math.floor(options.maxChars ?? 5_000)))
    const maxTargets = Math.max(1, Math.min(64, Math.floor(options.maxTargets ?? 8)))
    const queue: Array<{ text: string; sourceLocator: string; sourceFile?: string; depth: number }> = [{
      text,
      sourceLocator,
      sourceFile: options.sourceFile,
      depth: 0,
    }]
    const visited = new Set<string>()
    const traversedEdges = new Set<string>()
    const links: ResolvedLink[] = []
    const traces: LinkTraceEntry[] = []
    const parts: string[] = []
    let opened = 0
    let attempts = 0
    let usedChars = 0
    let truncated = false

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue
      const currentOptions: LinkResolverOptions = {
        ...options,
        sourceFile: current.sourceFile,
        maxTargets,
      }
      const currentLinks = this.resolveText(current.text, currentOptions)
      for (const link of currentLinks) {
        const edgeKey = `${current.sourceLocator}->${link.locator}`
        if (traversedEdges.has(edgeKey)) continue
        traversedEdges.add(edgeKey)
        links.push(link)
        if (visited.has(link.locator)) {
          traces.push({
            sourceLocator: current.sourceLocator,
            label: link.label,
            target: link.target,
            kind: link.kind,
            locator: link.locator,
            opened: false,
            reason: '检测到循环或已访问目标，停止继续展开',
          })
          continue
        }
        visited.add(link.locator)
        if (attempts >= maxReads) {
          truncated = true
          traces.push({
            sourceLocator: current.sourceLocator,
            label: link.label,
            target: link.target,
            kind: link.kind,
            locator: link.locator,
            opened: false,
            reason: '达到本轮链接读取次数上限，保留原文定位并交给搜索回退',
          })
          continue
        }
        if (usedChars >= maxChars) {
          truncated = true
          traces.push({
            sourceLocator: current.sourceLocator,
            label: link.label,
            target: link.target,
            kind: link.kind,
            locator: link.locator,
            opened: false,
            reason: '达到本轮链接字符预算，保留原文定位并交给搜索回退',
          })
          continue
        }
        attempts += 1
        const read = this.read(link, current.sourceLocator, Math.min(900, maxChars - usedChars))
        traces.push(read.trace)
        if (read.text !== '') opened += 1
        if (read.text !== '') {
          const excerpt = read.text.trim()
          if (excerpt !== '') {
            parts.push(`【链接资料：${link.label}】\n${excerpt}`)
            usedChars += excerpt.length
            if (usedChars >= maxChars) truncated = true
            if (current.depth + 1 < maxDepth) {
              queue.push({
                text: excerpt,
                sourceLocator: link.locator,
                sourceFile: link.path,
                depth: current.depth + 1,
              })
            }
          }
        }
      }
    }
    return { text: parts.join('\n\n---\n\n'), links, traces, opened, truncated }
  }

  /** Read only a bounded local excerpt. URLs, chats, directories and large files stay lazy. */
  read(link: ResolvedLink, sourceLocator: string, maxChars = 900): { text: string; trace: LinkTraceEntry } {
    const trace = (opened: boolean, reason: string): LinkTraceEntry => ({
      sourceLocator, label: link.label, target: link.target, kind: link.kind,
      locator: link.locator, opened, reason,
    })
    if (!link.exists || link.path === undefined || link.kind === 'url' || link.kind === 'chat') {
      return { text: '', trace: trace(false, link.exists ? '目标需要专用打开或搜索入口' : '目标不存在，交给全项目搜索兜底') }
    }
    try {
      const stat = fs.statSync(link.path)
      if (!stat.isFile()) return { text: '', trace: trace(false, '目录保持惰性浏览') }
      if (stat.size > 2 * 1024 * 1024) return { text: '', trace: trace(false, '文件过大，保持原始定位入口') }
      const content = link.kind === 'paper'
        ? execFileSync('pdftotext', ['-f', '1', '-l', '4', '-layout', link.path, '-'], {
            encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024,
          })
        : fs.readFileSync(link.path, 'utf8')
      if (content.includes('\u0000')) return { text: '', trace: trace(false, '二进制资料保持原始打开入口') }
      const text = content.slice(0, Math.max(1, maxChars))
      return { text, trace: trace(text !== '', text !== '' ? '按问题相关链接读取局部原文' : '目标为空，交给全项目搜索兜底') }
    } catch {
      return { text: '', trace: trace(false, '目标不可读取，交给全项目搜索兜底') }
    }
  }

  private resolveOne(label: string, rawTarget: string, source: 'markdown' | 'sidecar', options: LinkResolverOptions): ResolvedLink | undefined {
    let target = rawTarget.trim().replace(/^<|>$/g, '')
    if (target === '') return undefined
    // science/memory.ts sidecars store a typed target (for example a bare
    // session id or project-relative log path), so preserve that type before
    // applying ordinary Markdown path rules.
    if (source === 'sidecar' && options.sidecarKind !== undefined && !/^(?:https?:\/\/|evoresearch:\/\/|[a-z-]+:)/i.test(target)) {
      const sidecarKind = options.sidecarKind.toLowerCase()
      if (['chat', 'session', 'note', 'paper', 'experiment', 'run', 'log', 'file', 'code', 'latex', 'result', 'manuscript'].includes(sidecarKind)) {
        target = `${sidecarKind}:${target}`
      }
    }
    if (/^https?:\/\//i.test(target)) {
      const canonical = target.replace(/[.,;:!?]+$/, '')
      return { locator: canonical, kind: 'url', label: labelOf(label, canonical), target: canonical, source, exists: true, searchHint: labelOf(label, canonical) }
    }
    // Support evoresearch://chat/<id> in addition to the typed chat:<id> form.
    const uri = /^evoresearch:\/\/([a-z-]+)\/(.+)$/i.exec(target)
    if (uri) target = `${uri[1]}:${uri[2]}`
    // Only a colon introduces a typed locator. A normal relative path such as
    // `experiments/failed.log` must keep its first directory component.
    const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(target)
    const internal = isWindowsAbsolute ? undefined : /^(?:evoresearch:\/\/)?([a-z-]+):(.+)$/i.exec(target)
    const prefix = internal?.[1]?.toLowerCase()
    const value = stripAnchor((internal?.[2] ?? target).replace(/\\/g, path.sep))
    if (prefix === 'chat' || prefix === 'session') {
      return { locator: `chat:${value}`, kind: 'chat', label: labelOf(label, value), target: value, source, exists: true, searchHint: value }
    }
    const workspace = path.resolve(options.workspaceDir ?? this.dataRoot)
    const noteRoot = path.join(workspaceDataDir(this.dataRoot, workspace), 'memories', 'notes')
    let candidate: string
    let kind: ResolvedLinkKind
    if (prefix === 'note') { candidate = path.join(noteRoot, value.endsWith('.md') ? value : `${value}.md`); kind = 'note' }
    else if (prefix === 'experiment') { candidate = path.join(workspace, 'experiments', value); kind = 'experiment' }
    else if (prefix === 'run' || prefix === 'log' || prefix === 'result') { candidate = path.join(workspace, value); kind = prefix }
    else if (prefix === 'paper') { candidate = path.join(workspace, value); kind = 'paper' }
    else if (prefix === 'file' || prefix === 'code' || prefix === 'latex' || prefix === 'manuscript') { candidate = path.isAbsolute(value) ? value : path.join(workspace, value); kind = prefix }
    else if (prefix !== undefined && target.includes(':')) return undefined
    else { candidate = path.isAbsolute(value) ? value : path.resolve(options.sourceFile ? path.dirname(options.sourceFile) : workspace, value); kind = pathKind(candidate) }
    const resolved = path.resolve(candidate)
    const allowed = options.workspaceDir === undefined
      ? isInside(resolved, path.resolve(this.dataRoot))
      : isInside(resolved, workspace)
    if (!allowed) {
      return { locator: `invalid:${target}`, kind, label: labelOf(label, target), target, source, exists: false, searchHint: target }
    }
    let actual = resolved
    let exists = fs.existsSync(actual)
    // Files may be moved after a Memory link was written. A bounded basename
    // fallback keeps the link useful without turning it into an unbounded scan.
    // The locator is updated to the discovered path; the original target stays
    // in searchHint and trace for diagnosis.
    if (!exists && options.workspaceDir !== undefined) {
      const moved = this.findMovedFile(path.basename(resolved), workspace)
      if (moved !== undefined) {
        actual = moved
        exists = true
      }
    }
    const relative = path.relative(workspace, actual).split(path.sep).join('/')
    return {
      locator: `${kind}:${relative}`,
      kind, label: labelOf(label, target), target, source, exists, searchHint: `${label} ${target}`.trim(), path: actual,
    }
  }

  /** Bounded basename search used only after the original target disappeared. */
  private findMovedFile(basename: string, workspace: string): string | undefined {
    if (basename === '' || basename === '.' || basename === '..') return undefined
    const skip = new Set(['.git', '.evoresearch-data', 'node_modules', '.venv', 'dist', 'build'])
    const stack: Array<{ dir: string; depth: number }> = [{ dir: workspace, depth: 0 }]
    let visited = 0
    while (stack.length > 0 && visited < 800) {
      const current = stack.pop()!
      if (current.depth > 8) continue
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(current.dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (visited >= 800) break
        if (skip.has(entry.name)) continue
        visited += 1
        const full = path.join(current.dir, entry.name)
        if (entry.isFile() && entry.name === basename) return full
        if (entry.isDirectory()) stack.push({ dir: full, depth: current.depth + 1 })
      }
    }
    return undefined
  }
}

/** Read sidecar links for one science-memory Markdown file. */
export function sidecarLinksFor(file: string): SidecarLink[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(file), '.index.json'), 'utf8')) as { entries?: Record<string, { links?: SidecarLink[] }> }
    const links = raw.entries?.[path.basename(file)]?.links
    return Array.isArray(links) ? links : []
  } catch {
    return []
  }
}
