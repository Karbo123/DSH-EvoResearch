/**
 * 科学自演化记忆：Ideation Memory 与 Experimentation Memory（SCI-05/06）。
 *
 * 以 Markdown 和原始资料连接实现：
 * - 存储：<project>/.evoresearch-data/memories/science/{ideation,experimentation}/*.md，
 *   正文零 frontmatter（自由文本，用户可直接编辑导航文字与内容）；
 * - 自动生成的定位链接（回聊天/代码/日志/结果/笔记/实验）保存在目录侧车索引
 *   .index.json（软件维护，不混入正文；用户编辑正文不影响链接）；
 * - 保存成功方向、失败方向、有效做法和待重新尝试的想法——状态由用户正文的
 *   自然语言表达，add() 的 status 只作为初始正文模板提示，不强制结构化字段。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { workspaceDataDir } from '../core/paths.js'
import { randomUUID } from 'node:crypto'

/** 科学记忆类型。 */
export type ScienceMemoryKind = 'ideation' | 'experimentation'

/** 定位链接（自动生成，保留回到原文的入口）。 */
export interface ScienceMemoryLink {
  /** 展示标签（自然语言）。 */
  readonly label: string
  /** 定位目标：聊天 sessionId / 代码文件相对路径 / 日志路径 / 结果路径 / 笔记 id / 实验 slug。 */
  readonly target: string
  readonly kind: 'chat' | 'code' | 'log' | 'result' | 'note' | 'experiment'
}

/** 科学记忆条目（Markdown 文件 + 索引镜像）。 */
export interface ScienceMemoryEntry {
  readonly kind: ScienceMemoryKind
  /** 文件名（含 .md）。 */
  readonly fileName: string
  /** 标题（正文首个 H1；无则取文件名）。 */
  readonly title: string
  /** 全文（用户可编辑；零 frontmatter）。 */
  readonly body: string
  readonly updatedAt: number
  /** 自动生成的定位链接（索引维护）。 */
  readonly links: readonly ScienceMemoryLink[]
  /** 创建时间（索引记录）。 */
  readonly createdAt: number
}

/** 新增条目输入（status 只作正文模板提示，不强制字段）。 */
export interface ScienceMemoryInput {
  readonly title: string
  /** 正文（可选；status 提示会作为初始模板写入）。 */
  readonly body?: string
  readonly links?: readonly ScienceMemoryLink[]
  /** 初始正文模板：成功方向/失败方向/有效做法/待重试。 */
  readonly status?: 'success' | 'failed' | 'promising' | 'retry'
}

/** 索引文件结构。 */
interface ScienceMemoryIndex {
  entries?: Record<string, { links?: readonly ScienceMemoryLink[]; createdAt?: number }>
}

/** 文件名 slug（≤64 字符）。 */
function slugifyMemoryTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'entry'
}

/** 状态 → 初始正文模板（自然语言，用户可改可删）。 */
const STATUS_TEMPLATE: Record<string, string> = {
  success: '## 状态\n\n成功方向。\n\n## 经验\n\n（由用户或自动总结补充：什么有效、为什么有效）\n',
  failed: '## 状态\n\n失败方向。\n\n## 失败原因\n\n（由用户或自动总结补充：哪里失败了、为什么）\n\n## 可复用经验\n\n（由用户或自动总结补充：下次可以保留什么）\n',
  promising: '## 状态\n\n有前景但未验证。\n\n## 待验证\n\n（由用户或自动总结补充：下一步要验证什么）\n',
  retry: '## 状态\n\n待重新尝试。\n\n## 上次尝试\n\n（由用户或自动总结补充：上次做到哪一步、为什么停下）\n',
}

/** 科学记忆服务（SCI-05/06）。 */
export class ScienceMemory {
  constructor(readonly dataRoot: string) {}

  /** 记忆目录：<workspace>/.evoresearch-data/memories/science/<kind>/。 */
  dirOf(workspaceDir: string | undefined, kind: ScienceMemoryKind): string {
    return path.join(workspaceDataDir(this.dataRoot, workspaceDir), 'memories', 'science', kind)
  }

  private indexFile(workspaceDir: string | undefined, kind: ScienceMemoryKind): string {
    return path.join(this.dirOf(workspaceDir, kind), '.index.json')
  }

  private loadIndex(workspaceDir: string | undefined, kind: ScienceMemoryKind): ScienceMemoryIndex {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile(workspaceDir, kind), 'utf8')) as ScienceMemoryIndex
      return typeof raw === 'object' && raw !== null ? raw : {}
    } catch {
      return {}
    }
  }

  private saveIndex(workspaceDir: string | undefined, kind: ScienceMemoryKind, index: ScienceMemoryIndex): void {
    fs.mkdirSync(this.dirOf(workspaceDir, kind), { recursive: true })
    const tmp = `${this.indexFile(workspaceDir, kind)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8')
    fs.renameSync(tmp, this.indexFile(workspaceDir, kind))
  }

  /** 新增一条科学记忆（Markdown 文件 + 索引定位链接）。 */
  add(kind: ScienceMemoryKind, input: ScienceMemoryInput, workspaceDir?: string): ScienceMemoryEntry {
    const title = String(input.title ?? '').trim()
    if (title.length === 0) throw new Error('科学记忆标题不能为空')
    const dir = this.dirOf(workspaceDir, kind)
    fs.mkdirSync(dir, { recursive: true })
    const base = slugifyMemoryTitle(title)
    let fileName = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomUUID().replace(/-/g, '').slice(0, 8)
      const candidate = `${base}-${id}.md`
      if (!fs.existsSync(path.join(dir, candidate))) {
        fileName = candidate
        break
      }
    }
    if (!fileName) throw new Error('无法生成不冲突的科学记忆文件名')
    const template = input.status ? STATUS_TEMPLATE[input.status] ?? '' : ''
    const body = `${input.body?.trim() ?? ''}${input.body?.trim() ? '\n\n' : ''}${template}`.trim()
    const content = body.length > 0 ? `# ${title}\n\n${body}\n` : `# ${title}\n`
    fs.writeFileSync(path.join(dir, fileName), content, 'utf8')
    const index = this.loadIndex(workspaceDir, kind)
    index.entries = index.entries ?? {}
    index.entries[fileName] = {
      links: input.links ?? [],
      createdAt: Date.now(),
    }
    this.saveIndex(workspaceDir, kind, index)
    return {
      kind,
      fileName,
      title,
      body: content,
      updatedAt: Date.now(),
      links: input.links ?? [],
      createdAt: index.entries[fileName]!.createdAt ?? Date.now(),
    }
  }

  /** 列出全部条目（最新在前；索引损坏/缺失时仅按文件列出）。 */
  list(kind: ScienceMemoryKind, workspaceDir?: string): ScienceMemoryEntry[] {
    const dir = this.dirOf(workspaceDir, kind)
    const index = this.loadIndex(workspaceDir, kind)
    let names: string[] = []
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith('.md'))
    } catch {
      return []
    }
    const entries: ScienceMemoryEntry[] = []
    for (const name of names) {
      const file = path.join(dir, name)
      const body = readFileSafe(file)
      if (body === undefined) continue
      const title = titleOf(name, body)
      const meta = index.entries?.[name]
      entries.push({
        kind,
        fileName: name,
        title,
        body,
        updatedAt: statMtime(file),
        links: meta?.links ?? [],
        createdAt: meta?.createdAt ?? 0,
      })
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt)
    return entries
  }

  /** 读取单条。 */
  read(kind: ScienceMemoryKind, fileName: string, workspaceDir?: string): ScienceMemoryEntry | undefined {
    return this.list(kind, workspaceDir).find((entry) => entry.fileName === fileName)
  }

  /** 写入（用户编辑导航文字/正文；整文件写，零 frontmatter 语义）。 */
  write(kind: ScienceMemoryKind, fileName: string, body: string, workspaceDir?: string): ScienceMemoryEntry | undefined {
    const dir = this.dirOf(workspaceDir, kind)
    const file = path.join(dir, fileName)
    if (!fs.existsSync(file)) return undefined
    const content = String(body)
    if (content.trim().length === 0) return undefined
    fs.writeFileSync(file, content, 'utf8')
    const entry = this.read(kind, fileName, workspaceDir)
    return entry
  }

  /** 删除（用户可删导航文字；同时清理索引条目）。 */
  remove(kind: ScienceMemoryKind, fileName: string, workspaceDir?: string): boolean {
    const dir = this.dirOf(workspaceDir, kind)
    const file = path.join(dir, fileName)
    if (!fs.existsSync(file)) return false
    fs.rmSync(file, { force: true })
    const index = this.loadIndex(workspaceDir, kind)
    if (index.entries?.[fileName] !== undefined) {
      delete index.entries[fileName]
      this.saveIndex(workspaceDir, kind, index)
    }
    return true
  }

  /** 追加正文（自动总结只追加，不覆盖用户文字；SCI-09 精神）。 */
  appendBody(kind: ScienceMemoryKind, fileName: string, text: string, workspaceDir?: string): ScienceMemoryEntry | undefined {
    const current = this.read(kind, fileName, workspaceDir)
    if (!current) return undefined
    return this.write(kind, fileName, `${current.body.trim()}\n\n${String(text).trim()}\n`, workspaceDir)
  }
}

/** 安全读文件。 */
function readFileSafe(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** 文件 mtime（毫秒）。 */
function statMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** 标题 = 正文首个 H1（无则取文件名去后缀）。 */
function titleOf(fileName: string, body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim())
    if (match) return match[1]!.trim()
  }
  return fileName.replace(/\.md$/, '')
}
