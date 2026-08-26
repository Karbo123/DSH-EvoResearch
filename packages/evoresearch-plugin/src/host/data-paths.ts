/**
 * Runtime data-path discovery and relocation.
 *
 * DSH_HOME and EVORESEARCH_DATA_ROOT are process-start facts. This module
 * therefore persists a bootstrap document for the launcher and never claims
 * that changing the document hot-switched the current DSH process.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pluginDataDir, resolveDshHomePath } from './core/paths.js'

export type DataPathApplyMode = 'migrate' | 'reuse'

export interface DataPathPair {
  evoresearchRoot: string
}

export interface DataPathsSnapshot extends DataPathPair {
  /** 当前进程的兼容性事实字段；设置面板只编辑 evoresearchRoot。 */
  dshHome: string
  evoResearchDataRoot: string
  pluginStateRoot: string
  configPath: string
  restartManaged: boolean
  pending: boolean
}

export interface DirectoryRow {
  name: string
  path: string
  hidden: boolean
}

export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryRow[]
  entries: DirectoryRow[]
  roots: DirectoryRow[]
}

export interface DataPathApplyResult {
  paths: DataPathsSnapshot
  mode: DataPathApplyMode
  copiedEntries: number
  sourcePreserved: true
  restartRequired: boolean
  restartRequested: boolean
}

/** 清除数据面板展示的真实运行时位置。 */
export type DataClearPathEffect = 'delete-directory' | 'delete-children' | 'reset-file' | 'browser-storage'
export type DataClearPathId =
  | 'project-directory'
  | 'session-directory'
  | 'memories-directory'
  | 'chat-graphs-directory'
  | 'scheduler-file'
  | 'session-meta-file'
  | 'model-settings-file'
  | 'dsh-settings-file'
  | 'client-state-file'
  | 'browser-local-storage'

export interface DataClearPathEntry {
  id: DataClearPathId
  /** 文件系统绝对路径，或浏览器端存储的可读位置说明。 */
  path: string
  effect: DataClearPathEffect
}

export interface DataClearPaths {
  projects: DataClearPathEntry[]
  models: DataClearPathEntry[]
  prefs: DataClearPathEntry[]
}

interface BootstrapDocument {
  evoresearchRoot?: string
}

const PATH_CONFIG_ENV = 'EVORESEARCH_PATHS_CONFIG'
const RESTART_FILE_ENV = 'EVORESEARCH_RESTART_FILE'

function normalizedKey(value: string): string {
  const resolved = path.resolve(value).replace(/\\/g, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrInside(target: string, base: string): boolean {
  const t = normalizedKey(target)
  const b = normalizedKey(base).replace(/\/+$/, '')
  return t === b || t.startsWith(`${b}/`)
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrInside(left, right) || isSameOrInside(right, left)
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
}

export function normalizeDataPath(value: string, label = '数据目录'): string {
  const raw = value.trim()
  if (raw === '' || !isAbsolutePath(raw)) throw new Error(`${label}必须是绝对路径`)
  const result = path.resolve(raw)
  const root = path.parse(result).root
  if (normalizedKey(result) === normalizedKey(root)) throw new Error(`${label}不能直接使用磁盘根目录`)
  return result
}

function normalizeBrowsePath(value: string): string {
  const raw = value.trim()
  if (raw === '' || !isAbsolutePath(raw)) throw new Error('浏览目录必须是绝对路径')
  return path.resolve(raw)
}

export function dataPathsConfigPath(): string {
  const configured = process.env[PATH_CONFIG_ENV]?.trim()
  return path.resolve(configured || path.join(process.cwd(), '.evoresearch-paths.json'))
}

function restartRequestPath(): string | undefined {
  const value = process.env[RESTART_FILE_ENV]?.trim()
  return value === undefined || value === '' ? undefined : path.resolve(value)
}

function readBootstrapDocument(configPath = dataPathsConfigPath()): BootstrapDocument {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
    // 兼容旧版双路径配置；保存后会写成单一 evoresearchRoot。
    const legacyRoot = typeof raw.evoResearchDataRoot === 'string' && raw.evoResearchDataRoot !== ''
      ? raw.evoResearchDataRoot
      : typeof raw.dshHome === 'string' && raw.dshHome !== '' ? raw.dshHome : undefined
    const configured = typeof raw.evoresearchRoot === 'string' && raw.evoresearchRoot !== ''
      ? raw.evoresearchRoot
      : legacyRoot
    return {
      ...(configured !== undefined ? { evoresearchRoot: normalizeDataPath(configured, 'EVORESEARCH_ROOT') } : {}),
    }
  } catch {
    return {}
  }
}

function currentRoot(dataRoot: string): string { return path.resolve(dataRoot) }

export function getDataPaths(dataRoot: string): DataPathsSnapshot {
  const root = currentRoot(dataRoot)
  const dshHome = path.resolve(resolveDshHomePath())
  const configPath = dataPathsConfigPath()
  const pendingDoc = readBootstrapDocument(configPath)
  const pending = pendingDoc.evoresearchRoot !== undefined && normalizedKey(pendingDoc.evoresearchRoot) !== normalizedKey(root)
  return {
    evoresearchRoot: root,
    dshHome,
    evoResearchDataRoot: root,
    pluginStateRoot: pluginDataDir(root),
    configPath,
    restartManaged: restartRequestPath() !== undefined,
    pending,
  }
}

/**
 * 返回 dataClear() 实际会触及的路径。
 *
 * 这里和清除实现共用同一套运行时路径解析：DSH_HOME 可以与插件根目录
 * 相同，也可以暂时是历史上独立的目录；设置面板必须把两者的真实位置
 * 都展示出来，不能只根据 EVORESEARCH_ROOT 在浏览器端推测。
 */
export function getDataClearPaths(dataRoot: string): DataClearPaths {
  const root = currentRoot(dataRoot)
  const dshHome = path.resolve(resolveDshHomePath())
  const pluginRoot = pluginDataDir(root)
  const projectsRoot = path.join(root, 'projects')
  const sessionsRoot = path.join(dshHome, 'sessions')
  return {
    projects: [
      { id: 'project-directory', path: path.join(projectsRoot, '<project-name>'), effect: 'delete-directory' },
      { id: 'session-directory', path: path.join(sessionsRoot, '<workspace>'), effect: 'delete-directory' },
      { id: 'memories-directory', path: path.join(pluginRoot, 'memories'), effect: 'delete-directory' },
      { id: 'chat-graphs-directory', path: path.join(pluginRoot, 'chat-graphs'), effect: 'delete-directory' },
      { id: 'scheduler-file', path: path.join(pluginRoot, 'scheduler.json'), effect: 'reset-file' },
      { id: 'session-meta-file', path: path.join(pluginRoot, 'session-meta.json'), effect: 'reset-file' },
    ],
    models: [
      { id: 'model-settings-file', path: path.join(pluginRoot, 'model-settings.json'), effect: 'reset-file' },
      { id: 'dsh-settings-file', path: path.join(dshHome, 'settings.yaml'), effect: 'reset-file' },
    ],
    prefs: [
      { id: 'client-state-file', path: path.join(pluginRoot, 'client-state.json'), effect: 'reset-file' },
      { id: 'browser-local-storage', path: '当前网页的浏览器 localStorage（键名以 evoresearch- 开头）', effect: 'browser-storage' },
    ],
  }
}

function directoryRow(name: string, target: string): DirectoryRow {
  return { name, path: target, hidden: name.startsWith('.') }
}

function directoryAncestors(target: string): DirectoryRow[] {
  const rows: DirectoryRow[] = []
  let cursor = path.resolve(target)
  while (true) {
    const parent = path.dirname(cursor)
    const name = cursor === path.parse(cursor).root ? cursor : path.basename(cursor)
    rows.unshift(directoryRow(name, cursor))
    if (parent === cursor) break
    cursor = parent
  }
  return rows
}

function windowsRoots(): DirectoryRow[] {
  if (process.platform !== 'win32') return [directoryRow('/', '/')]
  const rows: DirectoryRow[] = []
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code)
    const root = `${letter}:\\`
    try {
      if (fs.statSync(root).isDirectory()) rows.push(directoryRow(`${letter}:`, root))
    } catch {
      // An unavailable drive is not a selectable directory.
    }
  }
  return rows
}

export function listDataDirectories(requestedPath?: string): DirectoryListing {
  const target = requestedPath === undefined || requestedPath.trim() === ''
    ? os.homedir()
    : normalizeBrowsePath(requestedPath)
  const entries: DirectoryRow[] = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      // Directory symlinks are returned as selectable directories as well.
      if (!entry.isSymbolicLink()) continue
      try {
        if (!fs.statSync(path.join(target, entry.name)).isDirectory()) continue
      } catch {
        continue
      }
    }
    entries.push(directoryRow(entry.name, path.join(target, entry.name)))
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return {
    path: path.resolve(target),
    home: path.resolve(os.homedir()),
    crumbs: directoryAncestors(target),
    entries,
    roots: windowsRoots(),
  }
}

function lstatOrMissing(target: string): fs.Stats | undefined {
  try { return fs.lstatSync(target) } catch { return undefined }
}

function sameFile(left: string, right: string): boolean {
  const leftStat = fs.statSync(left)
  const rightStat = fs.statSync(right)
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false
  return fs.readFileSync(left).equals(fs.readFileSync(right))
}

function validateTreeEntry(source: string, target: string): void {
  const sourceStat = fs.lstatSync(source)
  const existing = lstatOrMissing(target)
  if (sourceStat.isSymbolicLink()) {
    if (existing !== undefined && (!existing.isSymbolicLink() || fs.readlinkSync(target) !== fs.readlinkSync(source))) {
      throw new Error(`迁移冲突：${target}`)
    }
    return
  }
  if (sourceStat.isDirectory()) {
    if (existing !== undefined && !existing.isDirectory()) throw new Error(`迁移冲突：${target}`)
    for (const entry of fs.readdirSync(source)) validateTreeEntry(path.join(source, entry), path.join(target, entry))
    return
  }
  if (!sourceStat.isFile() || existing === undefined) return
  if (!existing.isFile() || !sameFile(source, target)) throw new Error(`迁移冲突：${target}`)
}

function copyTreeEntry(source: string, target: string): number {
  const sourceStat = fs.lstatSync(source)
  const existing = lstatOrMissing(target)
  if (sourceStat.isSymbolicLink()) {
    const sourceLink = fs.readlinkSync(source)
    if (existing !== undefined) {
      if (!existing.isSymbolicLink() || fs.readlinkSync(target) !== sourceLink) throw new Error(`迁移冲突：${target}`)
      return 0
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const targetType = fs.statSync(source).isDirectory() ? 'junction' : 'file'
    fs.symlinkSync(sourceLink, target, targetType)
    return 1
  }
  if (sourceStat.isDirectory()) {
    if (existing !== undefined && !existing.isDirectory()) throw new Error(`迁移冲突：${target}`)
    fs.mkdirSync(target, { recursive: true })
    let count = 0
    for (const entry of fs.readdirSync(source)) count += copyTreeEntry(path.join(source, entry), path.join(target, entry))
    return count
  }
  if (!sourceStat.isFile()) return 0
  if (existing !== undefined) {
    if (!existing.isFile() || !sameFile(source, target)) throw new Error(`迁移冲突：${target}`)
    return 0
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  return 1
}

/** Copy without overwriting. Identical files are treated as already migrated. */
export function copyTreeNoOverwrite(source: string, target: string): number {
  if (!fs.existsSync(source)) return 0
  if (pathsOverlap(source, target) && normalizedKey(source) !== normalizedKey(target)) {
    throw new Error(`迁移目标不能与旧数据目录嵌套：${target}`)
  }
  validateTreeEntry(source, target)
  return copyTreeEntry(source, target)
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

function requestRestart(configPath: string): boolean {
  const file = restartRequestPath()
  if (file === undefined) return false
  writeJsonAtomic(file, { requestedAt: new Date().toISOString(), configPath })
  return true
}

export function applyDataPaths(
  dataRoot: string,
  requested: DataPathPair,
  mode: DataPathApplyMode,
): DataPathApplyResult {
  if (mode !== 'migrate' && mode !== 'reuse') throw new Error('路径切换方式必须是 migrate 或 reuse')
  const currentRootPath = currentRoot(dataRoot)
  const currentDshHome = path.resolve(resolveDshHomePath())
  const nextRoot = normalizeDataPath(requested.evoresearchRoot, 'EVORESEARCH_ROOT')
  const sources = [currentDshHome, currentRootPath].filter((source, index, all) =>
    all.findIndex((item) => normalizedKey(item) === normalizedKey(source)) === index,
  )
  let copiedEntries = 0
  if (mode === 'migrate') {
    for (const source of sources) {
      if (normalizedKey(source) === normalizedKey(nextRoot)) continue
      if (pathsOverlap(source, nextRoot)) throw new Error(`新旧数据目录不能互相嵌套：${nextRoot}`)
      copiedEntries += copyTreeNoOverwrite(source, nextRoot)
    }
    // If a source was empty or absent, migration still creates the selected
    // destinations so the next DSH start has valid roots.
    fs.mkdirSync(nextRoot, { recursive: true })
  } else {
    fs.mkdirSync(nextRoot, { recursive: true })
  }
  const configPath = dataPathsConfigPath()
  const next: DataPathPair = { evoresearchRoot: nextRoot }
  writeJsonAtomic(configPath, next)
  const changed = normalizedKey(currentRootPath) !== normalizedKey(nextRoot)
    || normalizedKey(currentDshHome) !== normalizedKey(nextRoot)
  const restartRequested = changed ? requestRestart(configPath) : false
  const snapshot: DataPathsSnapshot = {
    ...next,
    dshHome: nextRoot,
    evoResearchDataRoot: nextRoot,
    pluginStateRoot: pluginDataDir(nextRoot),
    configPath,
    restartManaged: restartRequestPath() !== undefined,
    pending: changed,
  }
  return {
    paths: snapshot,
    mode,
    copiedEntries,
    sourcePreserved: true,
    restartRequired: changed,
    restartRequested,
  }
}
