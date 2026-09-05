// 视觉充分检查：全测试流程截图逐张评审
import fs from 'node:fs'
const apiKey = process.env.NEW_API_API_KEY
if (!apiKey) throw new Error('NEW_API_API_KEY is required for visual review')
const shots = ['full-open.png', 'full-menu.png', 'full-edges.png', 'full-editor.png', 'full-editor-saved.png', 'full-final.png', 'accept-projects.png', 'accept-subchats.png', 'accept-chat-opened.png']
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
          text: '这是科研 AI 工作台 EvoResearch 的 9 张验收截图（1=图谱初始、2=右键菜单、3=多节点多连线、4=记忆编辑弹窗、5=保存后、6=最终图谱、7=左侧项目列表、8=项目内子聊天列表、9=双击节点打开的对话页）。请用中文做最终专业 UI 评审：①整体是否美观协调、有无明显丑陋或突兀的元素；②图谱节点卡片/连线/端口/菜单质量；③编辑弹窗质量；④左侧导航质量；⑤对话页与整体协调。请给出「总评分/10 + 必须修复的问题清单（按优先级）+ 可暂缓的优化建议」。',
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
console.log('===== mimo-v2.5 最终视觉检查 =====')
console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 800))
process.exit(0)
