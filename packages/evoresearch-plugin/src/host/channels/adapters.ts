/**
 * 内置通道适配器。
 *
 * - TelegramAdapter：Bot API 长轮询（getUpdates/sendMessage），零依赖（Node 全局 fetch）；
 *   令牌来自环境变量 EVORESEARCH_TELEGRAM_TOKEN。
 * - Slack/QQ/微信/飞书/Signal：统一 HTTP webhook/polling 适配器。
 *   每个平台都使用真实 HTTP JSON 入站/出站端点，允许接入官方 Bot API、企业
 *   网关或本地 bridge；没有配置端点时只显示为 offline，不冒充在线。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelAdapter, ChannelMessage } from './base.js'

/**
 * 非 Telegram 平台的真实 HTTP 适配器。
 *
 * 入站端点返回 `[{id,senderId,senderName,chatId,text}]` 或
 * `{messages:[...]}`；出站端点接受 `{chat_id,text}`。端点可以是官方 Bot API
 * 的薄封装，也可以是 Windows 上的本地 bridge。适配器本身不复制平台协议，
 * 只负责可靠的归一化、游标去重、停止和错误隔离。
 */
export class PlatformHttpAdapter implements ChannelAdapter {
  private readonly inboxUrl: string | undefined
  private readonly sendUrl: string | undefined
  private readonly token: string | undefined
  private readonly pollMs: number
  private running = false
  private seen = new Set<string>()

  constructor(
    readonly id: string,
    readonly name: string,
    envPrefix: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.inboxUrl = env[`${envPrefix}_INBOX_URL`]
    this.sendUrl = env[`${envPrefix}_SEND_URL`]
    this.token = env[`${envPrefix}_TOKEN`]
    const configured = Number(env.EVORESEARCH_CHANNEL_POLL_MS ?? 1500)
    this.pollMs = Number.isFinite(configured) ? Math.max(500, configured) : 1500
  }

  isConfigured(): boolean {
    return Boolean(this.inboxUrl && this.sendUrl)
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    }
  }

  async start(_ctx: Context, onMessage: (message: ChannelMessage) => void): Promise<void> {
    if (!this.inboxUrl || !this.sendUrl) {
      throw new Error(`${this.name} 未配置：需要 ${this.id.toUpperCase()}_INBOX_URL 和 ${this.id.toUpperCase()}_SEND_URL`)
    }
    if (this.running) return
    this.running = true
    void this.poll(onMessage)
  }

  private async poll(onMessage: (message: ChannelMessage) => void): Promise<void> {
    while (this.running) {
      try {
        const response = await fetch(this.inboxUrl!, { headers: this.headers() })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json() as unknown
        const rows = Array.isArray(body) ? body : (body as { messages?: unknown })?.messages
        if (Array.isArray(rows)) {
          for (const raw of rows) {
            const value = raw as Record<string, unknown>
            const text = typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content : ''
            const messageId = String(value.messageId ?? value.message_id ?? value.id ?? '')
            if (!messageId || !text || this.seen.has(messageId)) continue
            this.seen.add(messageId)
            if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000))
            onMessage({
              messageId,
              senderId: String(value.senderId ?? value.sender_id ?? value.from ?? ''),
              senderName: String(value.senderName ?? value.sender_name ?? value.username ?? ''),
              chatId: String(value.chatId ?? value.chat_id ?? value.conversationId ?? ''),
              text,
              receivedAt: typeof value.receivedAt === 'number' ? value.receivedAt : Date.now(),
            })
          }
        }
      } catch (error) {
        console.error(`[evoresearch:${this.id}] HTTP 轮询失败:`, error instanceof Error ? error.message : String(error))
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
  }

  async stop(): Promise<void> { this.running = false }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.sendUrl) throw new Error(`${this.name} 未配置出站端点`)
    const response = await fetch(this.sendUrl, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!response.ok) throw new Error(`${this.name} 发送失败: HTTP ${response.status}`)
  }
}

/** Telegram Bot API 长轮询适配器。 */
export class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram'
  readonly name = 'Telegram'
  private token: string | undefined
  private offset = 0
  private polling = false
  private stopRequested = false
  private readonly base: string

  constructor(token?: string) {
    this.token = token ?? process.env.EVORESEARCH_TELEGRAM_TOKEN
    this.base = 'https://api.telegram.org'
  }

  isConfigured(): boolean {
    return Boolean(this.token)
  }

  async start(_ctx: Context, onMessage: (message: ChannelMessage) => void): Promise<void> {
    if (!this.token) throw new Error('未设置 EVORESEARCH_TELEGRAM_TOKEN')
    this.stopRequested = false
    this.polling = true
    // 长轮询循环（后台异步，不阻塞 start 返回）
    void this.pollLoop(onMessage)
  }

  private async pollLoop(onMessage: (message: ChannelMessage) => void): Promise<void> {
    while (this.polling && !this.stopRequested) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1)
          const message = update.message
          if (!message?.text) continue
          onMessage({
            messageId: String(message.message_id),
            senderId: String(message.from?.id ?? ''),
            senderName: message.from?.first_name ?? message.from?.username ?? '',
            chatId: String(message.chat.id),
            text: message.text,
            receivedAt: Date.now(),
          })
        }
      } catch (error) {
        // 网络抖动：静默重试（避免刷屏）
        console.error('[evoresearch:telegram] 轮询失败:', error instanceof Error ? error.message : error)
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  private async getUpdates(): Promise<Array<{ update_id: number; message?: { message_id: number; text?: string; chat: { id: number }; from?: { id: number; first_name?: string; username?: string } } }>> {
    const url = `${this.base}/bot${this.token}/getUpdates?timeout=30&offset=${this.offset}`
    const response = await fetch(url)
    const body = (await response.json()) as { ok: boolean; result?: unknown }
    if (!body.ok) throw new Error(`Telegram API 错误: ${JSON.stringify(body).slice(0, 200)}`)
    return Array.isArray(body.result) ? (body.result as never[]) : []
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    this.polling = false
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.token) throw new Error('未设置 EVORESEARCH_TELEGRAM_TOKEN')
    const response = await fetch(`${this.base}/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    const body = (await response.json()) as { ok: boolean }
    if (!body.ok) throw new Error(`Telegram 发送失败: ${JSON.stringify(body).slice(0, 200)}`)
  }
}

/** 全部内置适配器（与 EvoResearch channels 对应）。 */
export function builtinAdapters(): ChannelAdapter[] {
  return [
    new TelegramAdapter(),
    new PlatformHttpAdapter('slack', 'Slack', 'EVORESEARCH_SLACK'),
    new PlatformHttpAdapter('qq', 'QQ', 'EVORESEARCH_QQ'),
    new PlatformHttpAdapter('wechat', '微信', 'EVORESEARCH_WECHAT'),
    new PlatformHttpAdapter('feishu', '飞书', 'EVORESEARCH_FEISHU'),
    new PlatformHttpAdapter('signal', 'Signal', 'EVORESEARCH_SIGNAL'),
  ]
}
