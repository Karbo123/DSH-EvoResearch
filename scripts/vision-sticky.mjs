// 视觉评审：新布局（消息区内容自适应 + 输入框 sticky 底部）
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY
if (!apiKey) throw new Error('NEW_API_API_KEY is required for visual review')
const res = await fetch('http://127.0.0.1:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'mimo-v2.5',
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '这是科研 AI 工作台 EvoResearch 的截图（欢迎页，输入框刚被拖拽放大到较高高度）。请用中文做专业 UI 评审：①上方欢迎/消息区域与下方输入框的高度分配是否协调；②输入框是否自然贴底（应固定在视口底部附近）；③界面有无异常滚动条、溢出或错位。如无明显问题回答 OK 并简述亮点。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-port\\visual-sticky.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
