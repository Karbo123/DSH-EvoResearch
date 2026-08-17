#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'packages', 'evoresearch-app', 'package.json'), 'utf8'))
const source = readFileSync(join(root, 'packages', 'evoresearch-app', 'src', 'client', 'chatgraph-canvas.ts'), 'utf8')
const worker = readFileSync(join(root, 'packages', 'evoresearch-app', 'src', 'client', 'chatgraph-layout-worker.ts'), 'utf8')
const domain = readFileSync(join(root, 'packages', 'evoresearch-app', 'src', 'client', 'chatgraph.ts'), 'utf8')
const bundle = readFileSync(join(root, 'packages', 'evoresearch-app', 'lib', 'client', 'index.js'), 'utf8')

const checks = [
  ['@xyflow/react dependency', typeof (pkg.dependencies && pkg.dependencies['@xyflow/react']) === 'string'],
  ['elkjs dependency', typeof (pkg.dependencies && pkg.dependencies.elkjs) === 'string'],
  ['XYFlow renderer', source.includes('ReactFlow') && source.includes('Handle')],
  ['ELK worker', worker.includes("elkjs/lib/elk.bundled.js") && worker.includes('self.onmessage')],
  ['domain no handwritten SVG renderer', !domain.includes('evo-graph-svg') && !domain.includes('edgePath(')],
  ['built bundle contains XYFlow', bundle.includes('ReactFlow') && bundle.includes('elk-worker')],
]
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
if (!checks.every(([, ok]) => ok) || !existsSync(join(root, 'packages', 'evoresearch-app', 'test', 'chatgraph-layout.test.ts'))) process.exit(1)
