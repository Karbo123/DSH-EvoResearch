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
