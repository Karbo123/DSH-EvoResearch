// 视觉评审：Chat Graph 面板
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY
if (!apiKey) throw new Error('NEW_API_API_KEY is required for visual review')
const res = await fetch('http://127.0.0.1:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'mimo-v2.5',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '这是科研 AI 工作台 EvoResearch 的「聊天图谱」（Chat Graph）面板截图：画布上有聊天节点（带左侧蓝色 context 输入端口、绿色 memory 输入端口、右侧输出端口）和记忆节点（project/global），节点间有连线。请用中文做专业 UI 评审：①整体布局与节点卡片样式是否协调美观；②连线是否清晰可读；③端口位置与标识是否明确；④有无明显排版问题。如无明显问题回答 OK 并简述亮点；否则给出「问题 → 修改建议」。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-dev\\images\\visual-graph.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
