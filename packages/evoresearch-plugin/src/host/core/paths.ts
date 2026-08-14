/**
 * 科研项目路径与安全校验（Windows 优先）。
 *
 * 数据模型与 EvoResearch 一致：
 * - 项目根目录：<dataRoot>/projects/<name>/
 * - 项目数据目录：<dataRoot>/projects/<name>/.evoresearch-data/
 *   （记忆 research_memory.db、observations、profile、sessions 数据、CLI history、autoskills）
 * - WebUI 工作区只允许「部署根目录」或「projects/<name> 直接子目录」。
 *
 * 安全护栏：
 * - 拒绝控制字符、隐藏项（. 开头）进入项目名；
 * - resolve 后必须仍位于根目录内（防 .. 穿越）；
 * - Windows 大小写不敏感比较（normcase 后比较），兼容 drvfs 挂载。
 */
import * as path from 'node:path'
import * as fs from 'node:fs'

/** 项目名合法字符：小写字母/数字/连字符，≤64 字符。 */
export const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 每个项目的数据目录名。 */
export const PROJECT_DATA_DIR_NAME = '.evoresearch-data'

/** 项目根目录名。 */
export const PROJECTS_DIR_NAME = 'projects'

/** 规范化路径用于大小写不敏感比较（Windows）。 */
export function normPath(p: string): string {
  return path.normalize(p).toLowerCase()
}

/** 项目名是否合法。 */
export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_PATTERN.test(name)
}

/**
 * 生成项目名（确定性 slug）：仅保留小写字母/数字/连字符，≤20 字符；
 * 无任何字母数字时（如纯中文输入）回退 'project'。
 * 与 EvoResearch 的 _project_slug 回退语义一致。
 */
export function slugifyProjectName(input: string, maxLength = 20): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return /[a-z0-9]/.test(slug) ? slug : 'project'
}

/** 项目根目录（dataRoot/projects）。 */
export function projectsRoot(dataRoot: string): string {
  return path.join(dataRoot, PROJECTS_DIR_NAME)
}

/** 单个项目目录（dataRoot/projects/<name>）。 */
export function projectDir(dataRoot: string, name: string): string {
  if (!isValidProjectName(name)) {
    throw new Error(`非法的项目名: ${name}`)
  }
  return path.join(projectsRoot(dataRoot), name)
}

/** 项目数据目录（dataRoot/projects/<name>/.evoresearch-data）。 */
export function projectDataDir(dataRoot: string, name: string): string {
  return path.join(projectDir(dataRoot, name), PROJECT_DATA_DIR_NAME)
}

/** 项目记忆目录（.evoresearch-data/memories）。 */
export function projectMemoriesDir(dataRoot: string, name: string): string {
  return path.join(projectDataDir(dataRoot, name), 'memories')
}

/** 项目科研记忆库路径（.evoresearch-data/memories/research_memory.db）。 */
export function projectResearchMemoryPath(dataRoot: string, name: string): string {
  return path.join(projectMemoriesDir(dataRoot, name), 'research_memory.db')
}

/** 项目 Observations 目录（.evoresearch-data/memories/observations）。 */
export function projectObservationsDir(dataRoot: string, name: string): string {
  return path.join(projectMemoriesDir(dataRoot, name), 'observations')
}

/**
 * 校验一个绝对路径是否为合法的项目工作区：
 * 只能是「部署根目录」本身，或「projects/<name> 直接子目录」。
 * 返回 { kind: 'root' } 或 { kind: 'project', name, path }；不合法抛错。
 * 与 EvoResearch paths.validate_webui_workspace 语义一致。
 */
export function validateWorkspace(dataRoot: string, candidate: string): { kind: 'root' } | { kind: 'project'; name: string; path: string } {
  const root = path.resolve(dataRoot)
  const resolved = path.resolve(candidate)
  if (normPath(resolved) === normPath(root)) return { kind: 'root' }
  const projects = projectsRoot(root)
  if (normPath(path.dirname(resolved)) !== normPath(projects)) {
    throw new Error(`工作区必须是部署根目录或 projects/<name> 项目目录: ${candidate}`)
  }
  const name = path.basename(resolved)
  if (!isValidProjectName(name)) {
    throw new Error(`非法项目目录名: ${name}`)
  }
  return { kind: 'project', name, path: resolved }
}

/**
 * 解析工作区目录名 → 项目名（若它确实位于 projects/ 下）。
 * 返回 undefined 表示不是项目目录（即部署根）。
 */
export function projectNameFromWorkspace(dataRoot: string, workspaceDir: string): string | undefined {
  const root = path.resolve(dataRoot)
  const resolved = path.resolve(workspaceDir)
  const projects = projectsRoot(root)
  if (normPath(path.dirname(resolved)) === normPath(projects)) {
    const name = path.basename(resolved)
    if (isValidProjectName(name)) return name
  }
  return undefined
}

/** 列出项目目录下的所有项目名（跳过非目录/隐藏项）。 */
export function listProjects(dataRoot: string): string[] {
  const root = projectsRoot(dataRoot)
  let entries: import('node:fs').Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && isValidProjectName(e.name))
    .map((e) => e.name)
    .sort()
}
