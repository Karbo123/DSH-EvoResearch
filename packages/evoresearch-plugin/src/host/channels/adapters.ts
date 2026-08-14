/**
 * 内置通道适配器。
 *
 * - TelegramAdapter：Bot API 长轮询（getUpdates/sendMessage），零依赖（Node 全局 fetch）；
 *   令牌来自环境变量 EVORESEARCH_TELEGRAM_TOKEN。
 * - Slack/QQ/微信/飞书：第一版提供适配器骨架（start 提示未配置/待实现），
 *   与 EvoResearch 的 channels/ 目录一一对应，后续按同一接口补齐实现。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelAdapter, ChannelMessage } from './base.js'

/** 未实现的适配器骨架。 */
class PendingAdapter implements ChannelAdapter {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly envKey?: string,
  ) {}

  isConfigured(): boolean {
    return false
  }

  async start(): Promise<void> {
    throw new Error(`${this.name} 适配器待实现${this.envKey ? `（需要环境变量 ${this.envKey}）` : ''}`)
  }

  async stop(): Promise<void> {}

  async send(): Promise<void> {
    throw new Error(`${this.name} 适配器待实现`)
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
        console.error('[EVORESEARCH:telegram] 轮询失败:', error instanceof Error ? error.message : error)
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
    new PendingAdapter('slack', 'Slack', 'EVORESEARCH_SLACK_TOKEN'),
    new PendingAdapter('qq', 'QQ', 'EVORESEARCH_QQ_BOT_ID'),
    new PendingAdapter('wechat', '微信', 'EVORESEARCH_WECHAT_HOOK'),
    new PendingAdapter('feishu', '飞书', 'EVORESEARCH_FEISHU_APP_ID'),
    new PendingAdapter('signal', 'Signal', 'EVORESEARCH_SIGNAL_SOCKET'),
  ]
}
