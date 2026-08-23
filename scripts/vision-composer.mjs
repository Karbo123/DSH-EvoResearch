// 视觉模型评审：统计行外部居中 + Markdown 实时装饰层
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY
if (!apiKey) throw new Error('NEW_API_API_KEY is required for visual review')
const shots = ['visual-composer.png']
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
          text: '这是科研 AI 工作台 EvoResearch 的聊天界面截图。注意两个新特性：①底部统计行（"2 轮 · 6 步 | LLM 7s · 工具调用 471ms | 首 token 平均 682ms · 216 tok/s"）位于聊天输入框圆角矩形框的下面外部、水平居中、紧贴输入框；②输入框现在是 Markdown 实时样式化编辑器（输入内容"# 标题、**加粗**、*斜体*、链接、~~删除~~、`代码`、列表、引用"立即渲染成对应样式，语法标记字符隐藏但可编辑）。请用中文做专业 UI 评审，逐条给出「问题 → 修改建议」（如无明显问题回答 OK）。重点：统计行位置/对齐/间距是否合适、输入框实时渲染效果是否美观协调、有无遮挡或错位。',
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
