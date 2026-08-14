/**
 * core/paths 单元测试：项目名、路径安全、工作区校验（Windows 语义）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {
  isValidProjectName,
  slugifyProjectName,
  projectDir,
  projectDataDir,
  validateWorkspace,
  projectNameFromWorkspace,
  listProjects,
} from '../src/host/core/paths.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-paths-'))

describe('项目名', () => {
  it('合法名', () => {
    assert.equal(isValidProjectName('my-project'), true)
    assert.equal(isValidProjectName('a1'), true)
    assert.equal(isValidProjectName('deep-research-2026'), true)
  })

  it('非法名', () => {
    assert.equal(isValidProjectName('My-Project'), false) // 大写
    assert.equal(isValidProjectName('-lead'), false) // 前导连字符
    assert.equal(isValidProjectName('a b'), false) // 空格
    assert.equal(isValidProjectName('a.b'), false) // 点
    assert.equal(isValidProjectName(''), false)
  })

  it('slug 化', () => {
    assert.equal(slugifyProjectName('Deep Research 2026!'), 'deep-research-2026')
    assert.equal(slugifyProjectName('等变网络 研究'), 'project') // 纯中文回退
    assert.equal(slugifyProjectName('等变 SC 网络'), 'sc') // 保留英文词
    assert.equal(slugifyProjectName('a'.repeat(50)).length <= 20, true)
  })
})

describe('路径', () => {
  const root = path.join(TMP, 'root')

  it('项目目录与数据目录', () => {
    const dir = projectDir(root, 'demo')
    assert.equal(dir, path.join(root, 'projects', 'demo'))
    assert.equal(projectDataDir(root, 'demo'), path.join(root, 'projects', 'demo', '.evoresearch-data'))
  })

  it('非法名抛错', () => {
    assert.throws(() => projectDir(root, '../evil'))
  })

  it('工作区校验：仅部署根或 projects/<name> 直接子目录', () => {
    assert.deepEqual(validateWorkspace(root, root), { kind: 'root' })
    const project = validateWorkspace(root, path.join(root, 'projects', 'demo'))
    assert.equal(project.kind, 'project')
    if (project.kind === 'project') assert.equal(project.name, 'demo')
    // 深层子目录非法
    assert.throws(() => validateWorkspace(root, path.join(root, 'projects', 'demo', 'src')))
    // 项目外非法
    assert.throws(() => validateWorkspace(root, path.join(TMP, 'elsewhere')))
  })

  it('工作区 → 项目名解析', () => {
    assert.equal(projectNameFromWorkspace(root, path.join(root, 'projects', 'demo')), 'demo')
    assert.equal(projectNameFromWorkspace(root, root), undefined)
  })

  it('listProjects 只返回合法项目目录', () => {
    fs.mkdirSync(path.join(root, 'projects', 'good'), { recursive: true })
    fs.mkdirSync(path.join(root, 'projects', 'Bad_Name'), { recursive: true })
    fs.mkdirSync(path.join(root, 'projects', '.hidden'), { recursive: true })
    assert.deepEqual(listProjects(root), ['good'])
  })
})
