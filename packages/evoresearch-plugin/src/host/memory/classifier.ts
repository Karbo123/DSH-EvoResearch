/**
 * EvoMemory v2 分类器：每轮用户消息的多标签科研分类 + topic 归一化。
 *
 * 对齐 EvoResearch memory/research/classifier.py：
 * - 七类多标签分类（idea/method/experiment/related_work/reproduction/project/general）；
 * - 优先走 LLM（普通 JSON 输出 + 严格结构校验，兼容不支持 response_format 的端点）；
 * - 失败时回退确定性关键词分类，绝不阻塞主回答；
 * - topic 归一化：先按 label 词面/包含匹配复用已有 topic key，
 *   再按向量语义匹配（第一版留 EmbeddingProvider 接口，未接入时仅词面匹配）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { RESEARCH_CATEGORIES, type ResearchCategory } from '../../shared/types.js'
import { callJson, textMessage } from '../core/llm.js'

/** 分类结果。 */
export interface ClassificationResult {
  readonly categories: readonly ResearchCategory[]
  /** 每个类别的人类可读标签（用于 topic 归一化）。 */
  readonly labels: ReadonlyArray<{ category: ResearchCategory; label: string }>
  /** 是否来自确定性回退（LLM 失败时 true）。 */
  readonly fallback: boolean
}

/** 各类别关键词表（确定性回退用，中英双语）。 */
const CATEGORY_KEYWORDS: Record<ResearchCategory, readonly string[]> = {
  idea: ['idea', 'novel', '创新', '想法', '假设', 'hypothesis', '灵感', '构思', 'propose', '提出'],
  method: ['method', 'approach', '算法', '方法', '架构', 'architecture', 'pipeline', '流程', '训练', 'train', '优化', 'optimiz'],
  experiment: ['experiment', '实验', '评测', 'benchmark', '评估', 'evaluate', '消融', 'ablation', '测试', '结果', 'result', '指标', 'metric'],
  related_work: ['related', 'survey', '综述', '相关工作', '对比', 'comparison', 'baseline', '基线', '文献', 'paper', '论文'],
  reproduction: ['reproduc', '复现', '重现', '代码', 'code', 'bug', '调试', 'debug', '运行', 'run', '报错', 'error', '环境', 'install'],
  project: ['project', '项目', '计划', '规划', 'todo', '任务', 'milestone', '里程碑', '进度', 'schedule'],
  general: [],
}

/** 用关键词做确定性分类（回退路径）。 */
export function classifyDeterministic(text: string): ClassificationResult {
  const lower = text.toLowerCase()
  const matched = RESEARCH_CATEGORIES.filter((category) => {
    if (category === 'general') return false
    return CATEGORY_KEYWORDS[category].some((keyword) => lower.includes(keyword.toLowerCase()))
  })
  const categories: ResearchCategory[] = matched.length > 0 ? matched : ['general']
  return {
    categories,
    labels: categories.map((category) => ({ category, label: labelForCategory(category) })),
    fallback: true,
  }
}

/** 类别 → 默认展示标签。 */
export function labelForCategory(category: ResearchCategory): string {
  const labels: Record<ResearchCategory, string> = {
    idea: '新想法',
    method: '方法',
    experiment: '实验',
    related_work: '相关工作',
    reproduction: '复现',
    project: '项目',
    general: '综合',
  }
  return labels[category]
}

/** LLM 分类的 JSON 结构校验（严格）。 */
function validateClassification(value: unknown): { categories: ResearchCategory[]; labels: Array<{ category: ResearchCategory; label: string }> } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const categoriesRaw = raw['categories']
  const labelsRaw = raw['labels']
  if (!Array.isArray(categoriesRaw) || !Array.isArray(labelsRaw)) return undefined
  const categories: ResearchCategory[] = []
  for (const item of categoriesRaw) {
    if (typeof item === 'string' && (RESEARCH_CATEGORIES as readonly string[]).includes(item)) {
      categories.push(item as ResearchCategory)
    }
  }
  if (categories.length === 0) return undefined
  const labels: Array<{ category: ResearchCategory; label: string }> = []
  for (const item of labelsRaw) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const category = entry['category']
    const label = entry['label']
    if (typeof category === 'string' && (RESEARCH_CATEGORIES as readonly string[]).includes(category) && typeof label === 'string' && label.length > 0) {
      labels.push({ category: category as ResearchCategory, label })
    }
  }
  // 类别必须都有标签（缺失的用默认标签补齐）。
  for (const category of categories) {
    if (!labels.some((l) => l.category === category)) labels.push({ category, label: labelForCategory(category) })
  }
  return { categories, labels }
}

/** LLM 分类提示词（中文）。 */
const CLASSIFIER_SYSTEM = `你是一个科研对话分类器。请对用户的科研对话内容进行分类。

类别定义：
- idea：新的研究想法、假设、创新点
- method：研究方法、算法、架构、流程
- experiment：实验、评测、结果分析
- related_work：相关工作、文献综述、对比
- reproduction：复现、代码、调试、环境问题
- project：项目规划、任务、进度管理
- general：其他/综合

输出 JSON 格式：
{"categories": ["idea"], "labels": [{"category": "idea", "label": "中文短标签"}]}

要求：
1. categories 是字符串数组，可多标签（最多 3 个，按重要性排序），必须来自上述七类；
2. labels 与 categories 一一对应，label 是 2-12 个字符的中文短标签，概括该轮在该类别下的主题。`

/**
 * 使用 LLM 对一段文本做科研分类。
 * @param ctx Cordis 上下文。
 * @param provider 模型 provider。
 * @param model 模型名。
 * @param text 用户消息文本。
 * @param signal 可选取消信号。
 * @returns 分类结果；LLM 失败时回退确定性分类。
 */
export async function classifyRequest(
  ctx: Context,
  provider: string,
  model: string,
  text: string,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  try {
    const value = await callJson(ctx, {
      provider,
      model,
      messages: [text.slice(0, 4000)],
      maxTokens: 300,
      signal,
      jsonInstruction: '输出 JSON：{"categories": [...], "labels": [...]}',
    })
    const validated = validateClassification(value)
    if (validated) {
      return { categories: validated.categories, labels: validated.labels, fallback: false }
    }
  } catch {
    // LLM 调用失败：静默回退，不阻塞主流程
  }
  return classifyDeterministic(text)
}

/**
 * topic 归一化：把分类标签映射到稳定 topic key。
 * - 词面/包含匹配：已有 topic key 的 label 与候选标签相同、或互为子串时复用；
 * - 语义匹配：当 EmbeddingProvider 可用时按向量相似度（≥0.82）复用（第一版接口预留）；
 * - 无匹配时生成新 key（类别名 + 短哈希）。
 * @param existing 现有 (category → [{topicKey, label}])。
 * @param result 本次分类结果。
 * @param text 用户消息（用于生成新 key 的哈希种子）。
 */
export function canonicalizeTopicKeys(
  existing: ReadonlyMap<ResearchCategory, ReadonlyArray<{ topicKey: string; label: string }>>,
  result: ClassificationResult,
  text: string,
): { topicKey: string; label: string; category: ResearchCategory }[] {
  const outcome: Array<{ topicKey: string; label: string; category: ResearchCategory }> = []
  for (const { category, label } of result.labels) {
    const pool = existing.get(category) ?? []
    const normalized = normalizeLabel(label)
    // 1) 词面/包含匹配
    let matched = pool.find((entry) => {
      const existingLabel = normalizeLabel(entry.label)
      return existingLabel === normalized || existingLabel.includes(normalized) || normalized.includes(existingLabel)
    })
    // 2) 语义匹配（向量，第一版未接入 EmbeddingProvider 时跳过）
    if (!matched) {
      matched = semanticMatch(category, normalized, pool)
    }
    if (matched) {
      outcome.push({ topicKey: matched.topicKey, label: matched.label, category })
    } else {
      outcome.push({ topicKey: mintTopicKey(category, text, label), label, category })
    }
  }
  return outcome
}

/** 语义匹配钩子：接入 EmbeddingProvider 后按向量 ≥0.82 复用；当前返回 undefined。 */
function semanticMatch(
  _category: ResearchCategory,
  _normalizedLabel: string,
  _pool: ReadonlyArray<{ topicKey: string; label: string }>,
): { topicKey: string; label: string } | undefined {
  // TODO(EvoMemory v2): 接入 EmbeddingProvider（远端 embedding API 或本地 transformers.js）
  // 后，对 normalizedLabel 与 pool 中每个 label 计算余弦相似度，≥0.82 时复用 topicKey。
  return undefined
}

/** 标签归一化（小写、去空白与常见标点）。 */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[\s，。；、,.;:：'"“”‘’()（）[\]]/g, '').trim()
}

/** 生成新的稳定 topic key（类别前缀 + 内容短哈希）。 */
export function mintTopicKey(category: ResearchCategory, text: string, label: string): string {
  const seed = `${category}:${label}:${text}`
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const short = (hash >>> 0).toString(36).slice(0, 8)
  return `${category}-${short}`
}

/** 测试辅助：构造分类结果的快捷方式。 */
export function classifyForTest(categories: readonly ResearchCategory[]): ClassificationResult {
  return {
    categories,
    labels: categories.map((category) => ({ category, label: labelForCategory(category) })),
    fallback: true,
  }
}
