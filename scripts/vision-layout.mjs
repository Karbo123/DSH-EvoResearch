// 视觉评审：拖大输入框后的布局 + 细滚动条
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
          text: '这是科研 AI 工作台 EvoResearch 欢迎页截图（输入框高度刚被拖拽放大过）。请用中文做专业 UI 评审：①上方欢迎/消息区是否被输入框过度挤压（应有充足高度）；②输入框与上方区域的高度分配是否协调；③界面有无溢出、错位或异常滚动条；④滚动条样式是否纤细美观。如无明显问题回答 OK 并简述亮点。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-port\\visual-scrollbar.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
