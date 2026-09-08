/**
 * 0.1.3「Open in」轻量消费端（§OpenIn）。
 *
 * host 侧 dsh-host-open-in-app（patch 行 open-in-app）在 webServer 上注册三条
 * 路由：GET /open-in-app/apps（本机已解析的应用清单）、GET /open-in-app/icon/<id>
 * （PNG 图标）、POST /open-in-app/open（在指定应用中打开一个目录）。官方
 * dsh-client-ui-open-in-app 是 slot UI（自绘表面无宿主 slot），这里用自绘
 * Dropdown 消费同一组路由：应用清单懒加载一次，选中即以当前会话 cwd 发起打开。
 */
import { useEffect, useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import { Dropdown } from './dropdown'
import { toast } from './toast'
import { t } from './i18n'

export function OpenInMenu({ path }: { path: string | null }) {
  const [apps, setApps] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    // host 未挂 open-in-app 行时 404：静默隐藏菜单（功能属增强展示）
    void fetch('/open-in-app/apps').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!cancelled && Array.isArray(j?.apps) && j.apps.length > 0) setApps(j.apps as string[])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (path === null || apps.length === 0) return null
  return jsx(Dropdown, {
    value: '',
    options: apps.map((a) => ({ value: a, label: a })),
    placeholder: t('openIn'),
    title: t('openInTitle'),
    ariaLabel: t('openIn'),
    onChange: (app: string) => {
      if (busy || app === '') return
      setBusy(true)
      void fetch('/open-in-app/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app, path }),
      }).then((r) => (r.ok ? Promise.resolve({}) : r.json().catch(() => ({})))).then((j) => {
        if (j?.ok === false) toast(j?.error?.message ?? t('openInFailed'), 'error')
      }).catch(() => toast(t('openInFailed'), 'error')).finally(() => setBusy(false))
    },
  })
}
