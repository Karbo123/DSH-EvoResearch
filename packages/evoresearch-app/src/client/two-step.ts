/**
 * 两段式确认的自动复位定时器。
 *
 * 模式：点第一次进入「确认？」态并 arm 一个 5s 复位；此前实现各面板直接裸调
 * setTimeout——旧 timer 会在新确认窗口开启后把它截断（4.9s 时再点一次确认，
 * 0.1s 后被旧 timer 复位回去）。arm 先清旧 timer；卸载时统一清理。
 */
import { useEffect, useRef } from 'react'

export function useConfirmReset(): { arm: (apply: () => void) => void; cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])
  return {
    arm: (apply: () => void) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(apply, 5000)
    },
    cancel: () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
  }
}
