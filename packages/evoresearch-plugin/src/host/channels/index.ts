/**
 * 通道管理器：注册/启停/状态查询/消息转发。
 *
 * 收到通道消息后通过 deliver 回调投递给 agent（由 host 入口注入），
 * 与 EvoResearch channels/channel_manager.py 的语义一致。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelAdapter, ChannelAdapterStatus, ChannelMessage } from './base.js'
import type { ChannelStatus } from '../../shared/types.js'

/** 消息投递回调：把通道消息交给 agent 会话处理。 */
export type ChannelDeliver = (message: ChannelMessage) => Promise<string | undefined>

/** 通道管理器。 */
export class ChannelManager {
  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly running = new Set<string>()
  private readonly received = new Map<string, number>()
  private readonly sent = new Map<string, number>()
  private readonly errors = new Map<string, string>()
  private deliver: ChannelDeliver | undefined
  private ctx: Context | undefined

  constructor(adapters: readonly ChannelAdapter[], deliver?: ChannelDeliver) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter)
    this.deliver = deliver
  }

  /** 设置消息投递回调（host 入口注入）。 */
  setDeliver(deliver: ChannelDeliver): void {
    this.deliver = deliver
  }

  /** 全部适配器状态。 */
  status(): ChannelStatus[] {
    const result: ChannelStatus[] = []
    for (const adapter of this.adapters.values()) {
      result.push({
        id: adapter.id,
        name: adapter.name,
        online: this.running.has(adapter.id),
        received: this.received.get(adapter.id) ?? 0,
        sent: this.sent.get(adapter.id) ?? 0,
        error: this.errors.get(adapter.id),
      })
    }
    return result
  }

  /** 启动一个通道。 */
  async start(id: string): Promise<boolean> {
    const adapter = this.adapters.get(id)
    if (!adapter) return false
    if (this.running.has(id)) return true
    if (!adapter.isConfigured()) {
      this.errors.set(id, '未配置（请设置对应环境变量）')
      return false
    }
    try {
      await adapter.start(this.ctx!, (message) => {
        void this.onMessage(adapter, message)
      })
      this.running.add(id)
      this.errors.delete(id)
      return true
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /** 停止一个通道。 */
  async stop(id: string): Promise<boolean> {
    const adapter = this.adapters.get(id)
    if (!adapter || !this.running.has(id)) return false
    await adapter.stop()
    this.running.delete(id)
    return true
  }

  /** 启动全部已配置通道（host 入口在 attach 时调用）。 */
  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      if (adapter.isConfigured()) await this.start(adapter.id)
    }
  }

  /** 挂载：保存 ctx（start 时使用）。 */
  attach(ctx: Context): () => void {
    this.ctx = ctx
    return () => {
      this.ctx = undefined
      for (const id of [...this.running]) void this.stop(id)
    }
  }

  /** 处理一条通道消息：计数 + 投递。 */
  private async onMessage(adapter: ChannelAdapter, message: ChannelMessage): Promise<void> {
    this.received.set(adapter.id, (this.received.get(adapter.id) ?? 0) + 1)
    if (!this.deliver) {
      await adapter.send(message.chatId, 'EvoResearch 通道已收到消息，但 agent 未就绪。')
      return
    }
    try {
      const sessionId = await this.deliver(message)
      this.sent.set(adapter.id, (this.sent.get(adapter.id) ?? 0) + 1)
      if (sessionId) {
        await adapter.send(message.chatId, `已收到，交由 agent 处理（会话 ${sessionId.slice(0, 8)}…）。`)
      }
    } catch (error) {
      this.errors.set(adapter.id, error instanceof Error ? error.message : String(error))
      await adapter.send(message.chatId, `处理失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export type { ChannelAdapter, ChannelAdapterStatus, ChannelMessage }
