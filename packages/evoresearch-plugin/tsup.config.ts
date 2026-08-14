import { defineConfig } from 'tsup'

/**
 * 构建配置（tsup / esbuild）：
 * - host 插件与 client 插件分别打包为 ESM；
 * - @deepseek-ai/* 全部 external（作为 peerDependencies 由 DSH 部署提供），
 *   保持包体最小、避免重复实例化；
 * - 同时生成 .d.ts 类型声明。
 */
export default defineConfig([
  {
    entry: { 'host/index': 'src/host/index.ts' },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'lib',
    dts: { entry: { 'types/host/index': 'src/host/index.ts' } },
    external: [/^@deepseek-ai\//],
    // 修复：tsup 的 external 数组对 node:sqlite 未生效（输出被改写为裸 "sqlite"），
    // 直接注入 esbuild options 强制保留 node: 前缀。
    esbuildOptions(options) {
      options.external = [...(options.external ?? []), 'node:sqlite']
    },
    clean: false,
    sourcemap: true,
  },
  {
    entry: { 'client/index': 'src/client/index.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'browser',
    outDir: 'lib',
    tsconfig: 'tsconfig.client.json',
    dts: { entry: { 'types/client/index': 'src/client/index.ts' } },
    external: [/^@deepseek-ai\//, 'react', 'react-dom'],
    clean: false,
    sourcemap: true,
  },
])
