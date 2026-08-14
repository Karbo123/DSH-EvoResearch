/**
 * EvoResearch 浏览器表面运行时（node half）。
 *
 * 与官方 @deepseek-ai/dsh-web-app 的 web-runtime 同构，但 serve 的是
 * 本包自己的前端 dist（frontend/ 构建产物），并注册 EvoResearch 自己的
 * 表面提示段与 DSH_WEB_URL 变量。
 *
 * 本插件作为 cordis.patch.yml 的 app-runtime 行挂载（inject webStartup，
 * 旗标值来自 @deepseek-ai/dsh-web-app/startup 提供的 webStartup 服务）。
 */
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import { registerWorkspaceApi } from './workspace-api.js'

/** 稳定插件名（行 id 由 cordis.patch.yml 决定）。 */
const name = 'evoresearch-app'
/** 运行时服务名：绑定完成后释放 web 行（connection 行 inject 它）。 */
const WEB_RUNTIME_SERVICE = 'webRuntime'
/** webserver 绑定前需要的服务。 */
const inject = ['webServer']

const Config = z.object({
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
})

/** 本表面暴露给模型 shell 的规范本地 URL 环境变量名。 */
const DSH_WEB_URL = 'DSH_WEB_URL'
const LOOPBACK_HOST = '127.0.0.1'
/** webserver schema 的全接口绑定字面量。 */
const ALL_INTERFACES_HOST = '0.0.0.0'

/**
 * 从当前 server 绑定解析一次 LAN 信任快照。
 * 派生条目是无端口 IP 字面量：DNS 重绑定需要攻击者可控的域名，
 * 而 IP 字面量 Host 在任何端口都安全，OS 分配端口在绑定前不可知。
 */
function resolveLanTrust(bindHost, extra) {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces())
        .flat()
        .filter((iface) => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
        .map((iface) => iface.address)
    : []
  return {
    lanAddresses,
    trustedHosts: [...lanAddresses, ...extra],
  }
}

/** 模型可见的表面取向与接受边界（会话创建于 EvoResearch 工作台时注入）。 */
function evoresearchSurfacePrompt(webUrl) {
  return `你是 EvoResearch 工作台（基于 DeepSeek Harness 的科研工作台），用户正通过 ${webUrl} 使用你。当用户说"这个页面"、"这个界面"或"这个应用"而没有点名其他目标时，指的就是这个工作台。`
}

/** 从当前 webserver 解析规范回环 URL。 */
function localWebUrl(ctx) {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('evoresearch-app: 解析 Web 运行时缺少 webServer 服务')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/** dist 位置是本包的组装事实：通过相对 import.meta.url 解析，绝不配置。 */
function resolveDistIndex() {
  return fileURLToPath(new URL('../dist/index.html', import.meta.url))
}

/** 测试钩子：宿主没有构建 dist 时替换解析器；生产从不触碰。 */
const internals = { resolveDistIndex }

/**
 * 挂载 EvoResearch 运行时：dist 服务、表面提示、shell 变量与 URL 行。
 */
function apply(ctx, config) {
  const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts)
  ctx.provide(WEB_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  registerWorkspaceApi(ctx)
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'app:evoresearch-surface',
        order: -98,
        text: () => evoresearchSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      runtimeCtx.shellEnv.register({
        name: 'evoresearch-runtime',
        variables: { [DSH_WEB_URL]: { description: 'EvoResearch 工作台服务于本会话的规范本地 URL。' } },
        resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) }),
      })
    })
  }
  if (config.printUrl) {
    const printUrl = () => {
      const lanCandidate = runtime.lanAddresses[0]
      const port = ctx.webServer.port
      console.log(`evoresearch: ${localWebUrl(ctx)}${lanCandidate === undefined ? '' : ` (LAN: http://${lanCandidate}:${String(port)})`}`)
    }
    const settled = ctx.get('loader')?.await()
    if (settled === undefined) printUrl()
    else settled.then(() => {
      if (ctx.get('webServer') !== undefined) printUrl()
    }, () => {})
  }
}

export { apply, inject, name, Config, resolveLanTrust, internals }
