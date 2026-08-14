/**
 * @evoresearch/dsh-plugin 根入口 —— 浏览器插件的 node half。
 *
 * 纯 UI 插件：host 侧无行为（空 apply 仅让 Loader 能解析本行）；
 * 浏览器 half 经 package.json 的 `dsh.client` 声明被发现，
 * 由 dsh-client-modules 读取 exports["./client"] 作为 /plugins/<id>/client.js 提供。
 */
/** Host 插件体 —— 本 surface 插件无 host 侧行为。 */
export function apply(): void {
  console.log('[EVORESEARCH] client node half apply() 已执行')
}
