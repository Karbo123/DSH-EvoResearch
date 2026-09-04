/**
 * 视觉检查工具：调用视觉模型分析图片（用于 GUI 效果检查）。
 *
 * 模型配置来自 D:\ResearchOS\.env：
 *   RESEARCH_VISION_MODEL     模型名（如 mimo-v2.5）
 *   RESEARCH_VISION_MODEL_URL OpenAI 兼容端点（如 http://127.0.0.1:3000/v1）
 *   RESEARCH_VISION_MODEL_KEY API key
 *
 * 用法：
 *   node scripts/vision.mjs <图片路径> [检查指令]
 * 示例：
 *   node scripts/vision.mjs screenshot.png "检查这个应用启动界面是否正常"
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 从 .env 文件解析键值。 */
export function loadEnv(file = 'D:\\ResearchOS\\.env') {
  const result = {}
  if (!existsSync(file)) return result
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
  }
  return result
}

/** 读取视觉模型配置。 */
export function visionConfig(env = loadEnv()) {
  const model = env.RESEARCH_VISION_MODEL
  const url = env.RESEARCH_VISION_MODEL_URL
  const key = env.RESEARCH_VISION_MODEL_KEY
  if (!model || !url || !key) {
    throw new Error('缺少视觉模型配置（RESEARCH_VISION_MODEL / RESEARCH_VISION_MODEL_URL / RESEARCH_VISION_MODEL_KEY）')
  }
  return { model, url: url.replace(/\/+$/, ''), key }
}

/**
 * 调用视觉模型分析图片。
 * @param imagePath 本地图片路径（自动 base64 内嵌）。
 * @param instruction 检查指令。
 * @returns 模型分析文本。
 */
export async function analyzeImage(imagePath, instruction = '请详细描述这张截图的内容，并指出任何视觉问题（排版、布局、报错、黑屏等）。') {
  const config = visionConfig()
  if (!existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`)
  const base64 = readFileSync(imagePath).toString('base64')
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const body = {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1024,
  }
  const response = await fetch(`${config.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`视觉模型调用失败（${response.status}）: ${detail}`)
  }
  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error(`视觉模型响应异常: ${JSON.stringify(data).slice(0, 300)}`)
  return text
}

/** CLI 入口。 */
async function main() {
  const [imagePath, ...rest] = process.argv.slice(2)
  if (!imagePath) {
    console.error('用法: node scripts/vision.mjs <图片路径> [检查指令]')
    process.exit(1)
  }
  const instruction = rest.join(' ').trim() || undefined
  try {
    const config = visionConfig()
    console.log(`[vision] 模型: ${config.model} @ ${config.url}`)
    const text = await analyzeImage(imagePath, instruction)
    console.log('--- 视觉分析结果 ---')
    console.log(text)
  } catch (error) {
    console.error('[vision] 失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

if (process.argv[1] && process.argv[1].endsWith('vision.mjs')) {
  void main()
}
