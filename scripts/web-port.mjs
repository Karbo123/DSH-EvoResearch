import { createServer } from 'node:net'

/** 3080 永远保留给官方原版 DSH，EvoResearch Web 不应占用它。 */
export const RESERVED_PORTS = new Set([3080])

export function parsePort(value, label = '端口') {
  const text = String(value ?? '').trim()
  if (!/^\d{1,5}$/.test(text)) throw new Error(`无效${label}: ${text}`)
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效${label}: ${text}`)
  }
  if (RESERVED_PORTS.has(port)) {
    throw new Error(`端口 ${port} 保留给官方原版 DSH，EvoResearch Web 不使用该端口`)
  }
  return port
}

/**
 * 通过实际尝试监听 127.0.0.1 判断端口是否可用。
 * 仅探测，不会长期占用端口；调用方应在探测后尽快启动服务。
 */
export function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = createServer()
    let settled = false
    const finish = (available) => {
      if (settled) return
      settled = true
      resolve(available)
    }
    server.once('error', () => finish(false))
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => finish(true))
    })
  })
}

/** 从首选端口开始，向上寻找第一个空闲且未保留的端口。 */
export async function findAvailablePort(startPort, isAvailable = isPortAvailable) {
  for (let port = startPort; port <= 65535; port += 1) {
    if (RESERVED_PORTS.has(port)) continue
    if (await isAvailable(port)) return port
  }
  throw new Error(`从端口 ${startPort} 到 65535 都没有可用端口`)
}
