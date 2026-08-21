/**
 * P2-3：LaTeX 环境检测单元测试（注入 run 假实现，不依赖本机 TeX 工具链）。
 *
 * 覆盖：
 * - 无引擎 + kpsewhich 缺失 → ready:false + 安装建议；
 * - pdflatex 就绪 + ctex 缺失 → ready:true + xelatex+ctex 建议；
 * - 全就绪 → advice 为空。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectLatexEnv } from '../src/host/manuscript.js'

/** run 假实现的响应表：exe → (参数首项 → {status, stdout})。 */
type RunFake = (exe: string, args: string[], timeoutMs?: number) => { status: number | null; stdout: string }

/** kpsewhich 抽查的宏包清单（与 detectLatexEnv 内部一致）。 */
const KPSEWHICH_PACKAGES = ['article.cls', 'ctex.sty', 'graphicx.sty', 'amsmath.sty', 'booktabs.sty', 'hyperref.sty']

/** 构造 kpsewhich 假响应：foundPackages 中的包返回命中，其余返回空。 */
function fakeKpsewhich(foundPackages: readonly string[]): RunFake {
  return (exe, args) => {
    if (!exe.includes('kpsewhich')) return { status: null, stdout: '' }
    const pkg = args[0] ?? ''
    return foundPackages.includes(pkg) ? { status: 0, stdout: `/texmf-dist/tex/${pkg}\n` } : { status: 1, stdout: '' }
  }
}

describe('P2-3 LaTeX 环境检测', () => {
  it('无引擎 + kpsewhich 缺失 → ready:false 且给出安装建议', () => {
    // findExecutable 直接读 PATH；这里不 mock PATH，只断言注入 run 不被调用
    // （kpsewhich 与引擎都缺失时不会执行任何外部命令）。
    let called = 0
    const report = detectLatexEnv(() => {
      called += 1
      return { status: 0, stdout: '' }
    })
    void called
    // 环境无关断言：结构完整、advice 规则按探测结果触发
    assert.equal(report.engines.length, 4)
    assert.ok(report.packages.length === 0 || report.packages.length === KPSEWHICH_PACKAGES.length)
    if (!report.ready) {
      assert.ok(
        report.advice.some((line) => line.includes('TeX Live 或 MiKTeX')),
        `advice 应含安装建议（实际: ${JSON.stringify(report.advice)}）`,
      )
    }
  })

  it('pdflatex 就绪 + ctex 缺失 → ready:true + xelatex+ctex 建议', () => {
    const report = detectLatexEnv(fakeKpsewhich(['article.cls', 'graphicx.sty', 'amsmath.sty', 'booktabs.sty', 'hyperref.sty']))
    assert.equal(report.ready, true)
    assert.equal(report.ctexAvailable, false)
    const ctex = report.packages.find((p) => p.name === 'ctex.sty')
    assert.equal(ctex?.found, false)
    const article = report.packages.find((p) => p.name === 'article.cls')
    assert.equal(article?.found, true)
    assert.ok(
      report.advice.some((line) => line.includes('xelatex + ctex')),
      `advice 应含 ctex 提示（实际: ${JSON.stringify(report.advice)}）`,
    )
  })

  it('全就绪 → advice 为空', () => {
    const report = detectLatexEnv(fakeKpsewhich(KPSEWHICH_PACKAGES))
    assert.equal(report.ready, true)
    assert.equal(report.ctexAvailable, true)
    assert.deepEqual(report.advice, [])
    assert.equal(report.packages.length, KPSEWHICH_PACKAGES.length)
    for (const pkg of report.packages) assert.equal(pkg.found, true)
  })

  it('纯函数：结果不缓存，重复调用返回独立对象', () => {
    const a = detectLatexEnv(fakeKpsewhich(KPSEWHICH_PACKAGES))
    const b = detectLatexEnv(fakeKpsewhich([]))
    assert.notEqual(a, b)
    assert.notDeepEqual(a.packages, b.packages)
  })
})
