// 视觉评审：拖拽手柄悬停样式
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
          text: '这是科研 AI 工作台 EvoResearch 的聊天输入框截图（欢迎页，输入框在页面中部）。输入框顶部中央有一条细线手柄（拖拽调整输入框高度用，鼠标悬停时变品牌色并略微变宽）。请用中文做专业 UI 评审：悬停手柄样式是否协调美观、与整体风格是否一致、有无多余的空白或突兀元素。如无明显问题回答 OK 并简述亮点；否则给出「问题 → 修改建议」。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-dev\\images\\visual-grip.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
