// 视觉模型评审：输入框拖到最高时，上方消息区是否被压成一条缝
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
          text: '这是科研 AI 工作台 EvoResearch 的欢迎页截图，此时用户已把底部聊天输入框通过拖拽放大到了最大允许高度。请用中文回答三个问题：①上方欢迎/消息区域（输入框以上的部分）还剩多少视觉高度？是否被压缩成一条窄缝（比如只剩 100px 以内）？②如果要在这里浏览多轮聊天消息，这个高度是否足够舒适（消息区高度应大致为屏幕的 1/3 以上）？③整体高度分配是否协调？请给出「结论 + 依据」。',
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${fs.readFileSync('D:\\DSH-Research\\.tmp-dev\\images\\visual-maxdrag.png').toString('base64')}` },
        },
      ],
    }],
  }),
})
const data = await res.json()
console.log('===== mimo-v2.5 评审 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
