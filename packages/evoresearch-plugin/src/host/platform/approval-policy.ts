/**
 * 统一审批与危险操作策略（PLAT-15）。
 *
 * 主 Agent 与子代理共用同一策略：危险工具清单 + 审批模式（ask/allow/deny），
 * decideApproval 纯函数做同步判定；判定为 ask 时走 t8 adapters.approval
 * （fail-closed：服务缺失返回 unavailable=视为拒绝，绝不静默放行）。
 *
 * 现有 approval 服务核对：ctx.approval（ApprovalService.request → ApprovalOutcome
 * allowed-once/rejected/cancelled/unavailable；setPolicy 按 agent 覆盖）——
 * 本模块是策略层（判定），approval 是执行层（询问/记录），组合方式见
 * api-integration-plat3.md §4。
 */

/** 审批模式。 */
export type ApprovalMode = 'ask' | 'allow' | 'deny'

/** 危险工具默认清单（Windows 科研场景：shell/删除/覆盖/网络写/凭据）。 */
export const DEFAULT_DANGEROUS_TOOLS: readonly string[] = [
  'bash',
  'pwsh',
  'powershell',
  'run_code',
  'fs.rm',
  'fs.remove',
  'fs.rmdir',
  'fs.write',
  'fs.overwrite',
  'git.push',
  'git.reset',
  'git.clean',
  'net.http',
  'web.fetch',
  'credentials.write',
]

/** 审批策略。 */
export interface ApprovalPolicy {
  /** 默认模式（缺省 ask）。 */
  readonly mode: ApprovalMode
  /** 危险工具清单（缺省 DEFAULT_DANGEROUS_TOOLS）。 */
  readonly dangerousTools?: readonly string[]
  /** 单工具覆盖（如 { 'bash': 'allow', 'fs.rm': 'deny' }）。 */
  readonly overrides?: Readonly<Record<string, ApprovalMode>>
}

/** 判定结果。 */
export interface ApprovalDecision {
  readonly decision: 'allow' | 'ask' | 'deny'
  /** 判定依据（可读；记录用）。 */
  readonly reason: string
  /** 是否命中危险清单（未命中 = 非危险工具按默认模式）。 */
  readonly dangerous: boolean
}

/** 缺省策略（ask 模式 + 默认危险清单）。 */
export function defaultApprovalPolicy(): ApprovalPolicy {
  return { mode: 'ask', dangerousTools: DEFAULT_DANGEROUS_TOOLS }
}

/**
 * P3-2 无人值守危险 shell 命令段判定（纯函数）：
 * 把命令按管道/分节符（| ; && ||）切段后，任一段首词命中 deny-list 即 fail-closed。
 * allow-list 按「首段 + 子段」匹配（settings.yaml evoresearch.unattended.allowCommands）。
 */
/** 无人值守默认拒绝的命令段首词（比工具级清单更细：shell 内具体动作）。 */
export const UNATTENDED_SHELL_DENY_PATTERNS: readonly RegExp[] = [
  /^\s*(rm|rmdir)\s/i,
  /^\s*del\s/i,
  /^\s*rd\s/i,
  /^\s*format\s/i,
  /^\s*mkfs/i,
  /^\s*dd\s/i,
  /^\s*taskkill\b/i,
  /^\s*(ba)?sh\s*$/i,
  /^\s*powershell\s+-enc/i,
]

/** 会话来源 → 是否无人值守（scheduled/channel/science 触发的会话无人在看）。 */
export function isUnattendedSource(source: string | undefined | null): boolean {
  if (typeof source !== 'string') return false
  return /evoresearch:(channel|scheduler|science-candidate)/.test(source)
}

/**
 * 判定一条无人值守 shell 命令是否放行（P3-2 纯函数，fail-closed）：
 * - 任一命令段命中 deny 模式 → 拒绝；
 * - 存在 allow-list 且整条命令未命中任何允许前缀 → 拒绝（未配置时仅按 deny 模式）；
 * @param command 完整命令文本。
 * @param allowCommands 允许的命令首段列表（如 ['python', 'uv pip install']；空 = 未配置白名单）。
 */
export function decideUnattendedShell(command: string, allowCommands: readonly string[] = []): { allowed: boolean; reason: string } {
  const segments = command.split(/\|\||&&|;|\|/).map((s) => s.trim()).filter((s) => s !== '')
  for (const segment of segments) {
    for (const pattern of UNATTENDED_SHELL_DENY_PATTERNS) {
      if (pattern.test(segment)) {
        return { allowed: false, reason: `无人值守会话拒绝危险命令段「${segment.slice(0, 60)}」（命中 ${pattern}）；请有人在会话中确认后手动执行` }
      }
    }
  }
  if (allowCommands.length > 0) {
    const firstWord = (segments[0] ?? '').split(/\s+/)[0] ?? ''
    const ok = allowCommands.some((allow) => segments[0]?.toLowerCase().startsWith(allow.toLowerCase()) === true)
      && firstWord !== ''
    if (!ok) {
      return { allowed: false, reason: `无人值守会话命令不在 allow-list 中（首个命令段「${(segments[0] ?? '').slice(0, 60)}」）；可在 settings.yaml evoresearch.unattended.allowCommands 配置` }
    }
  }
  return { allowed: true, reason: '未命中无人值守拒绝规则' }
}

/**
 * 同步策略判定（PLAT-15 纯函数）：
 * - 工具名命中危险清单 → overrides 单工具覆盖 > 默认模式；
 * - 未命中危险清单 → allow（普通工具不需要审批）；
 * - 命中且模式为 ask → ask（交给 approval 服务执行询问；fail-closed）。
 */
export function decideApproval(policy: ApprovalPolicy, toolName: string): ApprovalDecision {
  const dangerous = (policy.dangerousTools ?? DEFAULT_DANGEROUS_TOOLS).includes(toolName)
  if (!dangerous) {
    return { decision: 'allow', reason: `工具 ${toolName} 不在危险清单`, dangerous: false }
  }
  const override = policy.overrides?.[toolName]
  const mode = override ?? policy.mode
  switch (mode) {
    case 'allow':
      return { decision: 'allow', reason: `危险工具 ${toolName} 被策略放行（override/allow 模式）`, dangerous: true }
    case 'deny':
      return { decision: 'deny', reason: `危险工具 ${toolName} 被策略拒绝（deny 模式）`, dangerous: true }
    case 'ask':
      return { decision: 'ask', reason: `危险工具 ${toolName} 需要审批（ask 模式）`, dangerous: true }
  }
}

/** 策略校验（模式合法 + 覆盖模式合法）。 */
export function validateApprovalPolicy(policy: ApprovalPolicy): { ok: boolean; error?: string } {
  if (policy.mode !== 'ask' && policy.mode !== 'allow' && policy.mode !== 'deny') {
    return { ok: false, error: `非法审批模式: ${String(policy.mode)}` }
  }
  if (policy.overrides) {
    for (const [tool, mode] of Object.entries(policy.overrides)) {
      if (mode !== 'ask' && mode !== 'allow' && mode !== 'deny') {
        return { ok: false, error: `工具 ${tool} 的覆盖模式非法: ${String(mode)}` }
      }
    }
  }
  return { ok: true }
}
