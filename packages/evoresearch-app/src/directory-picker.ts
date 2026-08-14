/**
 * directoryPicker 服务桩（阶段 0）。
 *
 * 官方 api-gateway（dsh-host-apiproxy）硬依赖 directoryPicker 服务；官方
 * 由 dsh-host-directory-picker-auto 提供（win32 回环下挂载 native 后端，
 * 其 client 面依赖 ui-workspace 外壳 —— 自定义表面不加载）。
 *
 * 本桩提供 `{ kind: 'none' }` capability：消费方按 seam 约定隐藏
 * picking 而非失败（README 原话：documented default for an unknown kind
 * is to hide the picking affordance rather than fail）。
 * 阶段 1 接入工作区创建时，再决定实现 browse 后端或复用官方 native 包。
 *
 * 挂载约定与官方后端包一致：Service 类默认导出（构造器完成注册），
 * 由 loader 直接实例化。
 */
import { Service } from '@deepseek-ai/cordis'

/** 稳定的 capability 对象（服务生命周期内不得更换）。 */
const NONE_CAPABILITY = { kind: 'none' }

class NoneDirectoryPicker extends Service {
  constructor(ctx) {
    super(ctx, 'directoryPicker')
  }

  capability() {
    return NONE_CAPABILITY
  }
}

export default NoneDirectoryPicker
