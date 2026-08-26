/**
 * 论文图片服务与工具测试（P2-1）。
 *
 * 覆盖：注入 fake runner 的渲染（产物扫描/版本递增/history+manifest 落盘）、
 * 重跑产生新版本、listFigures/getFigure 还原、解释器不可用失败不落记录、
 * 脚本路径越界拒绝、registerFigureTools 注册行为（critiqueImage 缺省 vs 提供）
 * 与 render_figure 直呼 execute 走通。
 *
 * 不依赖真实 python/matplotlib：runner 注入后自行在 FIGURE_OUT_DIR 写假产物。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  FigureService,
  registerFigureTools,
  slugTitle,
  type FigureRunnerOptions,
  type FigureToolsDeps,
} from '../src/host/figures.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 建临时工作区（项目目录），用例结束自动清理。 */
function makeWorkspace(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `figures-${prefix}-`))
  return dir
}

/** fake runner：exitCode 0 且在 FIGURE_OUT_DIR 写一个假 png。 */
function fakeRunnerOk(): (options: FigureRunnerOptions) => Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return async (options) => {
    const outDir = options.env['FIGURE_OUT_DIR'] ?? ''
    assert.notEqual(outDir, '', 'runner 应收到 FIGURE_OUT_DIR')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'fig.png'), '%PNG', 'utf8')
    return { exitCode: 0, stdout: 'rendered\n', stderr: '' }
  }
}

/** fake ctx：捕获注册的工具定义；get('tools') 返回注册表门面。 */
function captureCtx(): { ctx: Context; captured: ToolDefinition[] } {
  const captured: ToolDefinition[] = []
  const tools = {
    register(definition: ToolDefinition): () => void {
      captured.push(definition)
      return () => {
        const i = captured.indexOf(definition)
        if (i >= 0) captured.splice(i, 1)
      }
    },
  }
  const ctx = { get(name: string): unknown { return name === 'tools' ? tools : undefined } } as unknown as Context
  return { ctx, captured }
}

/** 构造直呼 execute 所需的 exec（agent.session.header.cwd 指向工作区）。 */
function execWithCwd(cwd: string): ToolRunContext {
  return {
    agent: { session: { header: { cwd } } },
  } as unknown as ToolRunContext
}

// ── slugTitle ───────────────────────────────────────────────────────────────

describe('slugTitle', () => {
  it('小写化 + 非法字符折叠为 -，截断 24 并去尾连字符', () => {
    assert.equal(slugTitle('Loss Curve V2'), 'loss-curve-v2')
    assert.equal(slugTitle('中文标题'), '')
    assert.equal(slugTitle('A'.repeat(40)), 'a'.repeat(24))
    assert.equal(slugTitle('--x--'), 'x')
  })
})

// ── FigureService.renderFigure ──────────────────────────────────────────────

describe('FigureService.renderFigure', () => {
  it('首次渲染成功：version 1、artifacts、latestPath、manifest/history 落盘', async () => {
    const ws = makeWorkspace('first')
    try {
      fs.writeFileSync(path.join(ws, 'plot.py'), 'print("ok")\n', 'utf8')
      const service = new FigureService({
        dataRoot: ws,
        resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
        runner: fakeRunnerOk(),
      })
      const result = await service.renderFigure({ workspaceDir: ws, scriptPath: 'plot.py', title: 'Loss Curve' })
      assert.equal(result.ok, true)
      assert.equal(result.version, 1)
      assert.deepEqual([...result.artifacts], ['fig.png'])
      assert.ok(result.latestPath !== null && result.latestPath.endsWith(`fig.png`))
      // figureId：slug-6位随机
      assert.match(result.figureId, /^loss-curve-[0-9a-f]{6}$/)

      const figureDir = path.join(ws, 'figures', result.figureId)
      assert.ok(fs.existsSync(path.join(figureDir, 'manifest.json')))
      assert.ok(fs.existsSync(path.join(figureDir, 'history.jsonl')))
      const manifest = JSON.parse(fs.readFileSync(path.join(figureDir, 'manifest.json'), 'utf8')) as Record<string, unknown>
      assert.equal(manifest['figure_id'], result.figureId)
      assert.equal(manifest['title'], 'Loss Curve')
      assert.equal(manifest['latest_version'], 1)
      assert.equal(manifest['latest_path'], result.latestPath)
      const historyText = fs.readFileSync(path.join(figureDir, 'history.jsonl'), 'utf8').trim()
      assert.equal(historyText.split('\n').length, 1)
      const line = JSON.parse(historyText) as Record<string, unknown>
      assert.equal(line['version'], 1)
      assert.equal(line['ok'], true)
      assert.deepEqual(line['artifacts'], ['fig.png'])
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('同一脚本重跑 → 复用 figureId，version 2；listFigures/getFigure 还原 versions=2', async () => {
    const ws = makeWorkspace('rerun')
    try {
      fs.writeFileSync(path.join(ws, 'plot.py'), 'print("ok")\n', 'utf8')
      const service = new FigureService({
        dataRoot: ws,
        resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
        runner: fakeRunnerOk(),
      })
      const first = await service.renderFigure({ workspaceDir: ws, scriptPath: 'plot.py', title: 'Loss' })
      const second = await service.renderFigure({ workspaceDir: ws, scriptPath: path.join(ws, 'plot.py'), title: 'Loss' })
      assert.equal(second.ok, true)
      assert.equal(second.figureId, first.figureId)
      assert.equal(second.version, 2)

      const figures = service.listFigures(ws)
      assert.equal(figures.length, 1)
      assert.equal(figures[0]!.figureId, first.figureId)
      assert.equal(figures[0]!.versions.length, 2)
      assert.equal(figures[0]!.versions[0]!.version, 1)
      assert.equal(figures[0]!.versions[1]!.version, 2)

      const got = service.getFigure(ws, first.figureId)
      assert.ok(got !== undefined)
      assert.equal(got.versions.length, 2)
      assert.equal(got.dirName, first.figureId)
      assert.equal(got.latestPath, second.latestPath)
      assert.equal(service.getFigure(ws, 'nope'), undefined)
      // 非法 id（防穿越）返回 undefined
      assert.equal(service.getFigure(ws, '..\\x'), undefined)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('resolvePython 返回 null → ok:false 带 error，且不落任何版本记录', async () => {
    const ws = makeWorkspace('nopy')
    try {
      fs.writeFileSync(path.join(ws, 'plot.py'), 'print("ok")\n', 'utf8')
      const service = new FigureService({ dataRoot: ws, resolvePython: () => null, runner: fakeRunnerOk() })
      const result = await service.renderFigure({ workspaceDir: ws, scriptPath: 'plot.py' })
      assert.equal(result.ok, false)
      assert.match(result.error ?? '', /Python 环境不可用/)
      assert.ok(fs.existsSync(path.join(ws, 'figures')) === false || service.listFigures(ws).length === 0)
      // history 无新行：figures 目录下没有任何图纸
      assert.deepEqual(service.listFigures(ws), [])
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('脚本路径越界（.. 出 workspaceDir）→ 失败', async () => {
    const ws = makeWorkspace('escape')
    try {
      const outside = makeWorkspace('outside')
      try {
        fs.writeFileSync(path.join(outside, 'evil.py'), 'print("evil")\n', 'utf8')
        const service = new FigureService({
          dataRoot: ws,
          resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
          runner: fakeRunnerOk(),
        })
        const result = await service.renderFigure({ workspaceDir: ws, scriptPath: path.join('..', path.basename(outside), 'evil.py') })
        assert.equal(result.ok, false)
        assert.match(result.error ?? '', /超出项目目录/)
        assert.deepEqual(service.listFigures(ws), [])
      } finally {
        fs.rmSync(outside, { recursive: true, force: true })
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('脚本不存在 → 失败且不落记录', async () => {
    const ws = makeWorkspace('missing')
    try {
      const service = new FigureService({
        dataRoot: ws,
        resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
        runner: fakeRunnerOk(),
      })
      const result = await service.renderFigure({ workspaceDir: ws, scriptPath: 'ghost.py' })
      assert.equal(result.ok, false)
      assert.match(result.error ?? '', /不存在/)
      assert.deepEqual(service.listFigures(ws), [])
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('非零退出码 → ok:false 但版本仍入 history；latest_* 不推进', async () => {
    const ws = makeWorkspace('failrun')
    try {
      fs.writeFileSync(path.join(ws, 'plot.py'), 'raise SystemExit(3)\n', 'utf8')
      const service = new FigureService({
        dataRoot: ws,
        resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
        runner: async () => ({ exitCode: 3, stdout: '', stderr: 'Traceback (most recent call last)\nValueError\n' }),
      })
      const result = await service.renderFigure({ workspaceDir: ws, scriptPath: 'plot.py', title: 'Bad' })
      assert.equal(result.ok, false)
      assert.equal(result.exitCode, 3)
      assert.match(result.logTail, /ValueError/)
      assert.equal(result.latestPath, null)
      const got = service.getFigure(ws, result.figureId)
      assert.ok(got !== undefined)
      assert.equal(got.versions.length, 1)
      assert.equal(got.versions[0]!.ok, false)
      assert.equal(got.latestPath, null)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })
})

// ── registerFigureTools ─────────────────────────────────────────────────────

describe('registerFigureTools', () => {
  function makeDeps(service: FigureService, dataRoot: string): FigureToolsDeps {
    return { service, dataRoot }
  }

  it('critiqueImage 缺省 → 只注册 render_figure/list_figures', () => {
    const ws = makeWorkspace('tools-min')
    try {
      const { ctx, captured } = captureCtx()
      const dispose = registerFigureTools(ctx, makeDeps(new FigureService({ dataRoot: ws }), ws))
      assert.deepEqual(captured.map((d) => d.name).sort(), ['list_figures', 'render_figure'])
      dispose()
      assert.equal(captured.length, 0)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('提供 critiqueImage → 三个工具都有；critique_figure 直呼 execute 返回 analysis', async () => {
    const ws = makeWorkspace('tools-full')
    try {
      const { ctx, captured } = captureCtx()
      let calledPath = ''
      let calledInstruction = ''
      const deps: FigureToolsDeps = {
        ...makeDeps(new FigureService({ dataRoot: ws }), ws),
        critiqueImage: async (imagePath, instruction) => {
          calledPath = imagePath
          calledInstruction = instruction
          return 'looks good'
        },
      }
      const dispose = registerFigureTools(ctx, deps)
      assert.deepEqual(captured.map((d) => d.name).sort(), ['critique_figure', 'list_figures', 'render_figure'])
      const critique = captured.find((d) => d.name === 'critique_figure')!
      const out = (await critique.execute({ image_path: path.join(ws, 'fig.png') }, execWithCwd(ws))) as { ok: boolean; analysis: string }
      assert.equal(out.ok, true)
      assert.equal(out.analysis, 'looks good')
      assert.equal(calledPath, path.join(ws, 'fig.png'))
      assert.match(calledInstruction, /论文图表标准/)
      // 异常路径 → ok:false + error
      const failing = registerFigureTools(ctx, {
        ...makeDeps(new FigureService({ dataRoot: ws }), ws),
        critiqueImage: async () => { throw new Error('vision down') },
      })
      void failing
      dispose()
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('render_figure 直呼 execute：走通渲染并输出 snake_case 字段', async () => {
    const ws = makeWorkspace('tools-render')
    try {
      fs.writeFileSync(path.join(ws, 'plot.py'), 'print("ok")\n', 'utf8')
      const service = new FigureService({
        dataRoot: ws,
        resolvePython: () => path.join(ws, '.venv', 'Scripts', 'python.exe'),
        runner: fakeRunnerOk(),
      })
      const { ctx, captured } = captureCtx()
      const dispose = registerFigureTools(ctx, makeDeps(service, ws))
      const render = captured.find((d) => d.name === 'render_figure')!
      const out = (await render.execute(
        { script_path: 'plot.py', title: 'Acc' },
        execWithCwd(ws),
      )) as Record<string, unknown>
      assert.equal(out['ok'], true)
      assert.equal(typeof out['figure_id'], 'string')
      assert.equal(out['version'], 1)
      assert.equal(out['exit_code'], 0)
      assert.deepEqual(out['artifacts'], ['fig.png'])
      assert.ok(typeof out['latest_path'] === 'string' && String(out['latest_path']).endsWith('fig.png'))
      assert.equal(out['error'], undefined)

      // list_figures 直呼：一条记录，versions=1
      const list = captured.find((d) => d.name === 'list_figures')!
      const listed = (await list.execute({}, execWithCwd(ws))) as { figures: Array<Record<string, unknown>> }
      assert.equal(listed.figures.length, 1)
      assert.equal(listed.figures[0]!['versions'], 1)
      assert.equal(listed.figures[0]!['figure_id'], out['figure_id'])
      dispose()
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('critique_figure 异常 → ok:false + error；缺 image_path → 提示错误', async () => {
    const ws = makeWorkspace('tools-crit-err')
    try {
      const { ctx, captured } = captureCtx()
      const dispose = registerFigureTools(ctx, {
        ...makeDeps(new FigureService({ dataRoot: ws }), ws),
        critiqueImage: async () => { throw new Error('vision down') },
      })
      const critique = captured.find((d) => d.name === 'critique_figure')!
      const bad = (await critique.execute({}, execWithCwd(ws))) as { ok: boolean; error?: string }
      assert.equal(bad.ok, false)
      assert.match(bad.error ?? '', /image_path/)
      const err = (await critique.execute({ image_path: 'x.png' }, execWithCwd(ws))) as { ok: boolean; error?: string }
      assert.equal(err.ok, false)
      assert.equal(err.error, 'vision down')
      dispose()
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })
})
