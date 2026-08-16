// 视觉评审：左侧项目列表 + 子聊天列表
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY ?? 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
const shots = ['visual-projects.png', 'visual-subchats.png']
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
          text: '这是科研 AI 工作台 EvoResearch 的左侧面板两张截图：第一张=项目列表视图（显示项目名+子聊天数），第二张=进入项目后的子聊天列表视图（顶部有返回按钮+项目名）。请用中文做专业 UI 评审：①项目列表行的样式（图标/名称/数量/箭头）是否协调美观；②子聊天视图的返回按钮与标题是否清晰；③两级导航是否直观；④有无明显排版问题。如无明显问题回答 OK 并简述亮点。',
        },
        ...shots.map((p) => ({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync(`D:\\DSH-Research\\.tmp-port\\${p}`).toString('base64')}` },
        })),
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
