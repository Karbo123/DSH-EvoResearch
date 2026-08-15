// 造 goal + 提案数据（Round 51 §19.6 验证）
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
const now = Date.now()
db.prepare('DELETE FROM research_goals WHERE goal_id = ?').run('goal-demo-proposal')
db.prepare('DELETE FROM goal_proposals WHERE goal_id = ?').run('goal-demo-proposal')
db.prepare(`INSERT INTO research_goals (goal_id, title, objective, criteria, constraints, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('goal-demo-proposal', '提案验证目标', '验证合同修改提案流程。', JSON.stringify([{ id: 'c1', text: '提案创建', satisfied: true, evidence: [] }]), JSON.stringify(['约束A']), 2, now, now)
db.prepare(`INSERT INTO goal_proposals (proposal_id, goal_id, title, summary, changes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run('proposal-demo-1', 'goal-demo-proposal', '扩大目标范围', '当前目标只覆盖第一阶段，建议扩展覆盖第二阶段。', JSON.stringify({ objective: '验证合同修改提案流程，并覆盖第二阶段。', constraints: ['约束A', '约束B'] }), 'pending', now)
console.log('seeded')
db.close()
