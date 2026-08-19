/**
 * 主题化下拉（仿左侧「搜索标题或内容」旁的排序弹层）：
 * 按钮 + 自定义浮层，避免原生 select 的长列表把弹层撑得过高；
 * 长列表限高滚动，选中项带对勾与品牌色高亮。
 */
import { useState, useEffect, useRef, type ComponentType } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { Check, ChevronDown } from 'lucide-react'
import { t } from './i18n'

export interface DropdownOption { value: string; label: string }

export function Dropdown({ value, options, onChange, placeholder, className, icon }: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  icon?: ComponentType
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; upward: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDocDown = (e: MouseEvent) => {
      const el = e.target as Node | null
      if (el === null) return
      if (btnRef.current !== null && btnRef.current.contains(el)) return
      if (el instanceof Element && el.closest('.evo-dropdown-menu') !== null) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    // 菜单自身的滚动（长列表滚动）不应关闭下拉；仅页面/容器滚动才关闭。
    const onScroll = (e: Event) => {
      const target = e.target as Node | null
      if (target instanceof Element && target.closest('.evo-dropdown-menu') !== null) return
      close()
    }
    // 滚轮悬停在打开的菜单上：阻止滚动冒泡到页面（避免页面一滚菜单就关闭）；
    // 菜单内容溢出时手动滚动菜单自身，未溢出时滚轮不产生任何副作用。
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null
      if (target === null) return
      const menu = target.closest('.evo-dropdown-menu')
      if (menu === null) return
      e.preventDefault()
      e.stopPropagation()
      if (menu.scrollHeight > menu.clientHeight) menu.scrollTop += e.deltaY
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r !== undefined) {
      const upward = r.bottom + 310 > window.innerHeight && r.top > 310
      setPos({ left: r.left, top: upward ? r.top - 6 : r.bottom + 6, width: r.width, upward })
    }
    setOpen(true)
  }
  const selected = options.find((o) => o.value === value)
  const display = selected?.label ?? (value !== '' ? value : (placeholder ?? t('assignmentNone')))
  return jsxs('div', {
    className: `evo-dropdown${className !== undefined ? ` ${className}` : ''}`,
    children: [
      jsx('button', {
        ref: btnRef,
        type: 'button',
        className: `evo-dropdown-btn${open ? ' evo-dropdown-open' : ''}`,
        'aria-expanded': open || undefined,
        'aria-haspopup': 'listbox',
        onClick: toggle,
        children: jsxs(Fragment, { children: [
          icon !== undefined && jsx(icon, {}),
          jsx('span', { className: 'evo-dropdown-value', children: display }),
          jsx(ChevronDown, {}),
        ] }),
      }),
      open && pos !== null && jsxs('div', {
        className: 'evo-dropdown-menu',
        role: 'listbox',
        style: {
          left: pos.left,
          top: pos.top,
          minWidth: Math.max(pos.width, 168),
          ...(pos.upward ? { transform: 'translateY(-100%)' } : {}),
        },
        children: options.map((o) => jsxs('button', {
          type: 'button',
          className: 'evo-dropdown-option',
          'data-active': o.value === value || undefined,
          role: 'option',
          'aria-selected': o.value === value || undefined,
          onClick: () => { onChange(o.value); setOpen(false) },
          children: [
            jsx('span', { children: o.label }),
            o.value === value && jsx(Check, {}),
          ],
        }, o.value)),
      }),
    ],
  })
}
