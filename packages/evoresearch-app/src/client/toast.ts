/**
 * 全局 Toast 通知（§33.2）：
 * 短暂状态反馈（保存成功、上传完成、模型切换完成等）；
 * 危险/不可逆操作不在此列（必须走二次确认 Dialog）。
 * 模块级状态 + 事件订阅（避免 context 穿透，root 挂载 <ToastHost/>）。
 */
import { jsx, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
}

let nextId = 1
let listeners: Array<(items: ToastItem[]) => void> = []
let items: ToastItem[] = []

function emit(): void {
  for (const listener of listeners) listener(items)
}

/** 弹出短暂通知（默认 3.2s 自动消失）。 */
export function toast(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  const id = nextId++
  items = [...items, { id, text, kind }]
  emit()
  setTimeout(() => {
    items = items.filter((item) => item.id !== id)
    emit()
  }, 3200)
}

/** Root 挂载的 Toast 容器。 */
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    const listener = (next: ToastItem[]) => setList(next)
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  }, [])
  return jsx(Fragment, {
    children: list.length > 0
      ? jsx('div', {
          className: 'evo-toast-host',
          children: list.map((item) => jsx('div', {
            className: `evo-toast evo-toast-${item.kind}`,
            children: item.text,
          }, item.id)),
        })
      : null,
  })
}
