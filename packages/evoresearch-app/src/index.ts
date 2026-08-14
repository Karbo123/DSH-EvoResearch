/**
 * @evoresearch/dsh-app 包根（node half）。
 *
 * 空 apply：本行的职责全部在 ./runtime（app-runtime 行，提供 webRuntime 服务、
 * serve 前端 dist）。包根保持空 apply，与官方 dsh-client-ui-* 的 node half
 * 同构 —— 这样 evoresearch-ui 行（name '@evoresearch/dsh-app'）在 host 侧
 * 无副作用，浏览器侧由 dsh-client-modules 经 dsh.client 声明加载 exports["./client"]。
 */
export function apply() {}
