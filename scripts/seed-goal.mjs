// 检查 research_goals 表结构并插入测试 goal（Round 50 UI 验证）
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
const cols = db.prepare('PRAGMA table_info(research_goals)').all().map((c) => c.name)
console.log('goal cols:', cols.join(','))
const now = Date.now()
const goal = {
  goal_id: 'goal-demo-round50',
  title: '验证目标合同展开',
  objective: '验证 Goals 面板行展开显示合同详情（目标/成功标准/约束）的功能。',
  criteria: JSON.stringify([
    { id: 'c1', text: '目标行可点击展开', satisfied: true, evidence: ['verify-project-create.mjs'] },
    { id: 'c2', text: '成功标准逐条显示且已满足项有标记', satisfied: true, evidence: [] },
    { id: 'c3', text: '证据数与约束标签正确渲染', satisfied: false, evidence: [] },
  ]),
  constraints: JSON.stringify(['中文界面', '无外网依赖']),
  version: 3,
  created_at: now,
  updated_at: now,
}
try {
  db.prepare('DELETE FROM research_goals WHERE goal_id = ?').run(goal.goal_id)
} catch { /* noop */ }
db.prepare(`INSERT INTO research_goals (${Object.keys(goal).join(',')}) VALUES (${Object.keys(goal).map(() => '?').join(',')})`).run(...Object.values(goal))
console.log('inserted', goal.goal_id)
const row = db.prepare('SELECT goal_id, title, version, updated_at FROM research_goals WHERE goal_id = ?').get(goal.goal_id)
console.log('row:', JSON.stringify(row))
db.close()
