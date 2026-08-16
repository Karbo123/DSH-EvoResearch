// 视觉评审：+ 菜单位置
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY ?? 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
const res = await fetch('http://127.0.0.1:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'mimo-v2.5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '这是科研 AI 工作台 EvoResearch 截图：顶部标签栏右侧「+」按钮打开的下拉菜单（从工作区打开… / 打开本地 PDF… / 创建新文件输入框）。请用中文做专业 UI 评审：菜单位置是否自然（应紧贴标签栏下方）、有无遮挡或错位、与界面风格是否协调。如无明显问题回答 OK 并简述亮点。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-port\\visual-tabmenu.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
