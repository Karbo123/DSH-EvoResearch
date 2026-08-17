/**
 * 上下文窗口保护层 + ContextAssembler（CTX-01..19）公开入口。
 *
 * - 检索解耦的窗口保护：本层只管"当前这一轮能放多少"——窗口压力、压缩适配
 *   与降级、工具结果裁剪归档、compaction 事件记录、工具历史修复、来源查询；
 * - ContextAssembler：以 (sessionId, userQuestion) 为入口临时组装
 *   Markdown 阅读材料（快速/深入两条路径）。
 *
 * 集成（由 host/index.ts 或实验编排层调用）：
 * ```ts
 * import { ContextWindowRuntime, ContextAssembler } from './context/index.js'
 * const guard = new ContextWindowRuntime({ dataRoot })
 * const dispose = guard.attach(ctx)   // 事件订阅 + 日志装载，返回 disposer
 * const assembler = new ContextAssembler({ store, notes, chatGraph, llm: ctx })
 * const material = await assembler.assemble({ sessionId, userQuestion, projectName, workspaceDir })
 * ```
 */
export * from './types.js'
export * from './window.js'
export * from './pruner.js'
export * from './compaction-log.js'
export * from './history-repair.js'
export * from './sources.js'
export * from './guard.js'
export * from './search.js'
export * from './render.js'
export * from './assembler.js'
