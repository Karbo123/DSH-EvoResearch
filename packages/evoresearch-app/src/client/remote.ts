/**
 * evoresearch Remote 描述符（client 端 $mount 贡献）。
 *
 * DSH 的 client Remote 服务（ctx.remote）命名空间只能经 $mount(contribution)
 * 安装（无 Proxy 参与查找）。官方 api-remotes 只挂载官方命名空间，本文件为
 * 插件（@evoresearch/dsh-plugin）的 evoresearch 命名空间构造等价的 wire 描述符：
 * 参数/结果 codec 用透传 schema（parse 原样返回），调用仍走官方 WebSocket
 * Remote 通道（typert interceptor 认领 endpoint 后按 namespace.method 分发到
 * host 的 EvoResearchApiService）。
 */

/** 透传 codec：schema.parse 原样返回（严格校验由 host 侧完成）。 */
function passthroughCodec() {
  return {
    mode: 'strict',
    typeSymbol: '@evoresearch/dsh-plugin/client#Passthrough',
    schema: { parse: (value: unknown) => value },
  }
}

/** 构造一个 direct 方法描述符。 */
function desc(id: string, method: string, params: string[]) {
  return {
    id,
    service: 'evoresearch',
    namespace: 'evoresearch',
    method,
    invocation: { kind: 'direct' },
    parameters: params.map((name) => ({
      name,
      wire: name,
      source: 'json',
      codec: passthroughCodec(),
    })),
    result: passthroughCodec(),
  }
}

/** 面板使用的最小方法集（与 host EvoResearchApiService 的 @Remote 方法对应）。 */
export const EVORESEARCH_REMOTE_CONTRIBUTION = {
  package: '@evoresearch/dsh-plugin',
  descriptors: [
    desc('@evoresearch/dsh-plugin#evoresearch/projectsList', 'projectsList', []),
    desc('@evoresearch/dsh-plugin#evoresearch/memoryCatalog', 'memoryCatalog', ['workspaceDir']),
    desc('@evoresearch/dsh-plugin#evoresearch/memoryGoals', 'memoryGoals', ['workspaceDir']),
    desc('@evoresearch/dsh-plugin#evoresearch/schedulerList', 'schedulerList', []),
    desc('@evoresearch/dsh-plugin#evoresearch/schedulerAdd', 'schedulerAdd', ['name', 'cron', 'command']),
    desc('@evoresearch/dsh-plugin#evoresearch/schedulerRemove', 'schedulerRemove', ['id']),
  ],
}

/** 最小化实验：只挂一个方法（诊断 $mount 卡点）。 */
export const EVORESEARCH_REMOTE_MINIMAL = {
  package: '@evoresearch/dsh-plugin',
  descriptors: [
    desc('@evoresearch/dsh-plugin#evoresearch/projectsList', 'projectsList', []),
  ],
}
