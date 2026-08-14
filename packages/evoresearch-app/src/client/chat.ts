/**
 * 中间聊天区（复刻 WebUI ChatInterface 视觉）：
 * 欢迎页（Where research evolves + 建议卡）+ 底部输入面板
 * （状态条 + textarea + 工具栏：附件 / Auto-approve / Send）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { Paperclip, ShieldCheck, ArrowUp } from 'lucide-react'

const SUGGESTED_PROMPTS = [
  'Survey recent papers on a topic',
  'Design an experiment plan',
  'Analyze workspace files',
]

export interface ChatAreaProps {
  /** 当前选中会话标题（无则 null） */
  currentTitle: string | null
  /** 会话是否正在运行 */
  running: boolean
  onSend: (text: string) => void
}

export function ChatArea({ currentTitle, running, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [height, setHeight] = useState<number | null>(null)

  const submit = () => {
    const text = input.trim()
    if (!text || running) return
    onSend(text)
    setInput('')
    setHeight(null)
  }

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        className: 'evo-chat',
        children: [
          currentTitle === null
            ? jsxs('div', {
                className: 'evo-welcome',
                children: [
                  jsx('h1', { children: 'Where research evolves' }),
                  jsx('p', { children: 'Your self-evolving lab partner — reads the literature, runs experiments, and remembers what matters.' }),
                  jsx('div', {
                    className: 'evo-suggest',
                    children: SUGGESTED_PROMPTS.map((p) => jsx('button', {
                      type: 'button',
                      className: 'evo-suggest-card',
                      onClick: () => onSend(p),
                      children: p,
                    }, p)),
                  }),
                ],
              })
            : jsxs('div', {
                className: 'evo-welcome',
                children: [
                  jsx('h1', { children: currentTitle }),
                  jsx('p', { children: running ? 'Running…' : 'Select a message to view details, or continue the conversation below.' }),
                ],
              }),
        ],
      }),
      jsxs('div', {
        className: 'evo-composer-wrap',
        children: [
          jsxs('div', {
            className: 'evo-composer',
            children: [
              jsxs('div', {
                className: 'evo-composer-status',
                children: [
                  jsx('span', { className: 'evo-composer-dot' }),
                  jsx('span', { children: currentTitle === null ? 'No active conversation' : running ? 'Running…' : currentTitle }),
                ],
              }),
              jsx('textarea', {
                className: 'evo-composer-textarea',
                placeholder: 'Ask EvoResearch anything...',
                rows: 1,
                value: input,
                style: height === null ? undefined : { height: `${height}px` },
                onInput: (e) => {
                  setInput(e.currentTarget.value)
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 220)}px`
                  setHeight(e.currentTarget.scrollHeight > 44 ? Math.min(e.currentTarget.scrollHeight, 220) : null)
                },
                onKeyDown: (e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    submit()
                  }
                },
              }),
              jsxs('div', {
                className: 'evo-composer-tools',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: 'Attach files',
                    children: jsx(Paperclip, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': autoApprove || undefined,
                    onClick: () => setAutoApprove((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(ShieldCheck, {}), jsx('span', { children: 'Auto-approve' })],
                    }),
                  }),
                  jsx('span', { className: 'evo-composer-spacer' }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-send',
                    disabled: !input.trim() || running,
                    onClick: submit,
                    children: jsxs(Fragment, {
                      children: [jsx('span', { children: 'Send' }), jsx(ArrowUp, {})],
                    }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
