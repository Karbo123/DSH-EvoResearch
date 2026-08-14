/**
 * 多智能体团队预设与专家邀请测试。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { TEAM_ROLES, findTeamRole, teamRoleIds } from '../src/host/teams.js'
import { ExpertService } from '../src/host/experts.js'

describe('团队预设（teams.ts）', () => {
  it('6 个科研角色齐全且 id 唯一', () => {
    assert.deepEqual(teamRoleIds(), ['planner', 'research', 'code', 'debug', 'data_analysis', 'writing'])
    const ids = new Set(teamRoleIds())
    assert.equal(ids.size, TEAM_ROLES.length)
  })

  it('每个角色有中文系统提示词与描述', () => {
    for (const role of TEAM_ROLES) {
      assert.ok(role.systemPrompt.length > 100, `${role.id} 缺少系统提示词`)
      assert.ok(role.description.length > 0, `${role.id} 缺少描述`)
      assert.ok(role.systemPrompt.includes('你'), `${role.id} 提示词应为中文第二人称`)
    }
  })

  it('findTeamRole 按 id 查找', () => {
    assert.equal(findTeamRole('planner')?.name, '规划专家')
    assert.equal(findTeamRole('unknown'), undefined)
  })
})

describe('ExpertService 内置团队邀请', () => {
  let dataRoot: string
  let ctx: Context
  let experts: ExpertService

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'EVORESEARCH-team-'))
    ctx = new Context()
    experts = new ExpertService({ dataRoot })
  })

  afterEach(() => {
    // 清理
  })

  it('邀请内置团队（无需技能目录）', async () => {
    const invited = await experts.invite(ctx, 'planner')
    assert.equal(invited, true)
    const teams = await experts.list()
    assert.ok(teams.some((t) => t.name === 'planner'))
  })

  it('未知角色且无技能服务时回退记录邀请', async () => {
    const invited = await experts.invite(ctx, 'some-skill')
    assert.equal(invited, true) // skills 服务缺失时宽容处理
  })

  it('list 始终展示全部内置团队候选（未邀请的也列出）', async () => {
    const teams = await experts.list()
    assert.ok(teams.length >= TEAM_ROLES.length)
    for (const role of TEAM_ROLES) {
      assert.ok(teams.some((t) => t.name === role.id), `缺少候选 ${role.id}`)
    }
  })

  it('activeTeamNames 返回已邀请角色', async () => {
    await experts.invite(ctx, 'research')
    await experts.invite(ctx, 'writing')
    const names = experts.activeTeamNames()
    assert.deepEqual(names, ['research', 'writing'])
  })
})
