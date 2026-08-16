// 视觉评审：Markdown 渲染排版（行距/段落间距）
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY ?? 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
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
          text: '这是科研 AI 工作台 EvoResearch 中一条 AI 回复的 Markdown 渲染效果（含二级/三级标题、段落、有序/无序列表、引用、代码块、分割线、加粗）。请用中文做专业排版评审：①行与行之间的间距是否过宽？段落之间是否有"多余空白行"？②标题与正文的间距是否合适？③列表、引用、代码块的排版是否紧凑协调？④如果要"紧凑化"，请给出具体的 CSS 建议（line-height、margin、padding 数值）。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-port\\visual-md-sample.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
