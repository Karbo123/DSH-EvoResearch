// 视觉模型评审：仅我的消息（开/关）两张截图
import fs from 'node:fs'

const shots = ['visual-useronly-on.png', 'visual-useronly-off.png']
const apiKey = process.env.NEW_API_API_KEY ?? 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
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
          text: '这是科研 AI 工作台 EvoResearch 的聊天界面截图（第一张=开启「仅我的消息」过滤模式——只显示用户消息、隐藏 AI 回复；输入框工具栏有一个人形图标按钮，消息列表顶部有虚线提示条。第二张=正常全量模式）。请用中文做专业 UI/排版评审，逐条给出「问题 → 具体修改建议」（如无明显问题则回答 OK）。重点检查：过滤模式下界面是否整洁合理、人形按钮位置是否合适、提示条样式是否协调、两种模式对比是否有异常。',
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
