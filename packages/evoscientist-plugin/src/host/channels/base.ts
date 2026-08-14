/**
 * 消息通道框架：通道适配器接口与消息模型。
 *
 * 对齐 EvoScientist channels/ 的设计：CLI 为枢纽，Telegram/Slack/QQ/微信/飞书等
 * 通道共用同一 agent 会话。每个适配器实现本接口，由 ChannelManager 统一启停与转发。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 通道消息（已归一化）。 */
export interface ChannelMessage {
  /** 通道内消息 id。 */
  readonly messageId: string
  /** 发送者标识（通道内 id）。 */
  readonly senderId: string
  /** 发送者显示名（可为空）。 */
  readonly senderName: string
  /** 会话/群标识（用于回复）。 */
  readonly chatId: string
  /** 文本内容。 */
  readonly text: string
  /** 到达时间（毫秒）。 */
  readonly receivedAt: number
}

/** 通道适配器。 */
export interface ChannelAdapter {
  /** 通道 id（小写英文，如 telegram）。 */
  readonly id: string
  /** 通道显示名。 */
  readonly name: string
  /** 是否已配置（配置缺失时 start 会失败并给出提示）。 */
  isConfigured(): boolean
  /** 启动（长连接/轮询）；收到消息时回调 onMessage。 */
  start(ctx: Context, onMessage: (message: ChannelMessage) => void): Promise<void>
  /** 停止。 */
  stop(): Promise<void>
  /** 发送文本到某个 chat。 */
  send(chatId: string, text: string): Promise<void>
}

/** 适配器状态。 */
export interface ChannelAdapterStatus {
  readonly id: string
  readonly name: string
  readonly online: boolean
  readonly received: number
  readonly sent: number
  readonly error?: string
  readonly configured: boolean
}
