// 视觉评审：Chat Graph 验收截图
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY
if (!apiKey) throw new Error('NEW_API_API_KEY is required for visual review')
const shots = ['accept-graph-initial.png', 'accept-graph-menu.png', 'accept-graph-after.png', 'accept-chat-opened.png', 'accept-projects.png', 'accept-subchats.png']
const res = await fetch('http://127.0.0.1:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'mimo-v2.5',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '这是科研 AI 工作台 EvoResearch 的 6 张截图（第1-3张=聊天图谱画布：初始/右键菜单/新建节点与连线后；第4张=双击聊天节点打开的对话；第5张=左侧项目列表；第6张=项目内子聊天列表）。请用中文做严格的专业 UI/UX 评审，逐张指出「问题 → 具体修改建议」，并总体评分（0-10）。重点关注：①图谱画布美观度（节点卡片/端口/连线/背景/间距）②右键菜单样式 ③对话页与图谱的整体协调 ④左侧项目导航美观度 ⑤任何突兀、不专业、不协调的元素。请具体、可执行。',
        },
        ...shots.map((p) => ({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync(`D:\\DSH-Research\\.tmp-dev\\images\\${p}`).toString('base64')}` },
        })),
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
