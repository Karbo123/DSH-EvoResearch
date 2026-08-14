/**
 * `node:module` 的浏览器替身（与官方 apps/web 的 node-module-stub.ts 同构）。
 *
 * 被 vendored cordis Loader（@deepseek-ai/cordis-plugin-loader）唯一引用；
 * createRequire 在浏览器启动路径中不可达，若假设改变则大声失败。
 */

/** node:module 的 createRequire 的抛错替身（浏览器启动中永不触达）。 */
export const createRequire = () => {
  throw new Error('node:module is not available in the browser')
}
