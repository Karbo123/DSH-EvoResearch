/**
 * 科研项目工作区服务：projects/<name>/ 的生命周期管理。
 *
 * 对齐 EvoResearch 的项目工作区语义：
 * - 项目目录：<dataRoot>/projects/<name>/，独立 git 仓库；
 * - 项目数据：<dataRoot>/projects/<name>/.evoresearch-data/（写入项目自身 git exclude）；
 * - WebUI 工作区只允许「部署根目录」或「projects/<name> 直接子目录」；
 * - 导入项目：复制到隐藏临时目录后原子改名，失败清理；跳过可重建目录
 *   （.venv/node_modules/.next/dist/__pycache__）；缺 .git 自动初始化；
 * - New Chat 自动创建：AI 生成 slug（≤20 字符，失败确定性回退，碰撞加数字后缀）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  isValidProjectName,
  listProjects,
  projectDataDir,
  projectDir,
  projectsRoot,
  slugifyProjectName,
  validateWorkspace,
} from './core/paths.js'
import type { ProjectInfo } from '../shared/types.js'
import { callJson } from './core/llm.js'
import { isLowInformationInput } from './core/title.js'

/** 导入/复制时跳过的可重建目录。 */
const SKIP_DIRS = new Set(['.venv', 'node_modules', '.next', 'dist', '__pycache__', '.pytest_cache', '.ruff_cache', '.git'])

/** 工作区服务配置。 */
export interface WorkspaceConfig {
  /** 部署根目录（projects/ 所在目录）。 */
  readonly dataRoot: string
}

/** 项目工作区服务。 */
export class WorkspaceService {
  constructor(readonly config: WorkspaceConfig) {}

  /** 列出全部项目。 */
  listProjects(): ProjectInfo[] {
    return listProjects(this.config.dataRoot).map((name) => {
      const dir = projectDir(this.config.dataRoot, name)
      let createdAt = 0
      try {
        createdAt = fs.statSync(dir).birthtimeMs
      } catch {
        // 目录不存在时忽略
      }
      return { name, path: dir, dataDir: projectDataDir(this.config.dataRoot, name), createdAt }
    })
  }

  /** 项目绝对路径（校验名称）。 */
  projectPath(name: string): string {
    return projectDir(this.config.dataRoot, name)
  }

  /**
   * 创建项目：建目录 + git init + .evoresearch-data git exclude。
   * @param name 项目名（合法名直接使用；非法名自动 slug 化）。
   * @returns 项目信息。
   */
  createProject(name: string): ProjectInfo {
    const safe = isValidProjectName(name) ? name : slugifyProjectName(name)
    const dir = projectDir(this.config.dataRoot, safe)
    fs.mkdirSync(dir, { recursive: true })
    this.prepareProjectGit(dir)
    // §5.4：创建基础 README（幂等，仅当不存在）
    const readme = path.join(dir, 'README.md')
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, `# ${safe}\n\nEvoResearch 项目工作区。\n`, 'utf8')
    }
    return { name: safe, path: dir, dataDir: projectDataDir(this.config.dataRoot, safe), createdAt: Date.now() }
  }

  /** 项目是否已存在。 */
  hasProject(name: string): boolean {
    return isValidProjectName(name) && fs.existsSync(projectDir(this.config.dataRoot, name))
  }

  /**
   * 导入已有项目文件夹：
   * 复制到 projects/.import-<name>-<rand>/ 隐藏临时目录，完成后原子改名 projects/<name>/。
   * @param sourcePath 源项目绝对路径。
   * @param requestedName 期望项目名（可省略，自动取目录名）。
   * @returns 项目信息。
   */
  importProject(sourcePath: string, requestedName?: string): ProjectInfo {
    const source = path.resolve(sourcePath)
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`源目录不存在或不是文件夹: ${sourcePath}`)
    }
    const baseName = requestedName && requestedName.trim().length > 0
      ? requestedName.trim()
      : path.basename(source)
    let name = isValidProjectName(baseName) ? baseName : slugifyProjectName(baseName)
    // 名称碰撞时追加数字后缀（不复用已有项目）
    if (this.hasProject(name)) {
      let suffix = 2
      while (this.hasProject(`${name}-${suffix}`)) suffix += 1
      name = `${name}-${suffix}`
    }
    const projects = projectsRoot(this.config.dataRoot)
    const tmpDir = path.join(projects, `.import-${name}-${process.pid}-${Date.now().toString(36)}`)
    const finalDir = projectDir(this.config.dataRoot, name)
    try {
      fs.mkdirSync(projects, { recursive: true })
      copyTree(source, tmpDir, SKIP_DIRS)
      // 缺少 .git 时初始化
      if (!fs.existsSync(path.join(tmpDir, '.git'))) {
        this.prepareProjectGit(tmpDir)
      } else {
        this.writeGitExclude(path.join(tmpDir, '.git'))
      }
      fs.renameSync(tmpDir, finalDir)
    } catch (error) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      throw error
    }
    return { name, path: finalDir, dataDir: projectDataDir(this.config.dataRoot, name), createdAt: Date.now() }
  }

  /** git init + .evoresearch-data git exclude（幂等）。 */
  prepareProjectGit(dir: string): void {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
    }
    this.writeGitExclude(path.join(dir, '.git'))
  }

  /** 把 .evoresearch-data/ 写入 git info/exclude（仅当尚未存在）。 */
  private writeGitExclude(gitDir: string): void {
    const excludeFile = path.join(gitDir, 'info', 'exclude')
    try {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true })
      const content = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : ''
      if (!content.includes('.evoresearch-data/')) {
        fs.appendFileSync(excludeFile, '\n# EvoResearch 项目数据（记忆/会话/观测）\n.evoresearch-data/\n')
      }
    } catch {
      // git 目录不可写时静默（非致命）
    }
  }

  /** 校验工作区路径合法（部署根 或 projects/<name>）。 */
  validateWorkspace(candidate: string): { kind: 'root' } | { kind: 'project'; name: string; path: string } {
    return validateWorkspace(this.config.dataRoot, candidate)
  }

  /**
   * New Chat 自动创建项目工作区：AI 生成 slug（≤20 字符，失败确定性回退，碰撞加后缀）。
   * @param ctx Cordis 上下文（LLM 调用）。
   * @param model 辅助模型。
   * @param description 用户首条消息（用于生成项目名）。
   */
  async autoCreateProject(ctx: Context, model: { provider: string; model: string }, description: string): Promise<ProjectInfo> {
    const seed = description.trim()
    let slug = ''
    // 空描述或低信息输入（问候/询问助手能力）不调用模型，避免模型凭空编造
    // 与对话内容无关的目录名；确定性回退到 slugify（纯中文/空 → project）。
    if (seed !== '' && !isLowInformationInput(seed)) {
      try {
        const value = await callJson(ctx, {
          provider: model.provider,
          model: model.model,
          messages: [`根据以下研究描述生成一个简短英文项目名（小写字母/数字/连字符，≤20 字符）:\n${seed.slice(0, 2000)}`],
          // 推理型模型需要给足预算：思考过程会先消耗 token，太小会导致正文为空。
          maxTokens: 200,
          jsonInstruction: '输出 JSON：{"slug": "project-name"}',
        })
        if (typeof value === 'object' && value !== null) {
          const candidate = (value as Record<string, unknown>)['slug']
          if (typeof candidate === 'string') slug = slugifyProjectName(candidate)
        }
      } catch {
        // LLM 失败：确定性回退
      }
    }
    if (!slug) slug = slugifyProjectName(seed)
    if (!slug) slug = 'project'
    let name = slug
    if (this.hasProject(name)) {
      let suffix = 2
      while (this.hasProject(`${name}-${suffix}`)) suffix += 1
      name = `${name}-${suffix}`
    }
    return this.createProject(name)
  }

  /** 项目工作区目录的绝对路径（供 sandbox 前缀等使用）。 */
  workspaceDirOf(workspace: string): string {
    return path.resolve(workspace || this.config.dataRoot)
  }
}

/** 递归复制目录树（跳过 SKIP_DIRS）。 */
function copyTree(source: string, target: string, skip: ReadonlySet<string>): void {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const src = path.join(source, entry.name)
    const dst = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyTree(src, dst, skip)
    } else if (entry.isSymbolicLink()) {
      try {
        fs.symlinkSync(fs.readlinkSync(src), dst)
      } catch {
        // 符号链接失败（如权限）时跳过
      }
    } else {
      fs.copyFileSync(src, dst)
    }
  }
}
