import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyDataPaths, copyTreeNoOverwrite, getDataClearPaths, getDataPaths } from '../src/host/data-paths.js'
import { migrateLegacyPluginData } from '../src/host/core/paths.js'

test('legacy root-level plugin data is moved to plugins without touching project data', () => {
  const base = mkdtempSync(join(tmpdir(), 'evoresearch-legacy-plugin-'))
  const legacy = join(base, '.evoresearch-data')
  try {
    mkdirSync(join(legacy, 'chat-graphs'), { recursive: true })
    mkdirSync(join(base, 'projects', 'demo', '.evoresearch-data'), { recursive: true })
    writeFileSync(join(legacy, 'chat-graphs', 'demo.json'), '{"nodes":[],"edges":[] }\n')
    writeFileSync(join(base, 'projects', 'demo', '.evoresearch-data', 'private.txt'), 'project data\n')

    const result = migrateLegacyPluginData(base)
    assert.equal(result.moved, true)
    assert.deepEqual(result.conflicts, [])
    assert.equal(readFileSync(join(base, 'plugins', 'chat-graphs', 'demo.json'), 'utf8'), '{"nodes":[],"edges":[] }\n')
    assert.equal(existsSync(legacy), false)
    assert.equal(readFileSync(join(base, 'projects', 'demo', '.evoresearch-data', 'private.txt'), 'utf8'), 'project data\n')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('migrate copies both roots without deleting the sources', () => {
  const base = mkdtempSync(join(tmpdir(), 'evoresearch-data-paths-'))
  const oldDsh = join(base, 'old-dsh')
  const oldEvo = join(base, 'old-evo')
  const newRoot = join(base, 'new-root')
  const config = join(base, 'paths.json')
  const restart = join(base, 'restart.json')
  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    EVORESEARCH_PATHS_CONFIG: process.env.EVORESEARCH_PATHS_CONFIG,
    EVORESEARCH_RESTART_FILE: process.env.EVORESEARCH_RESTART_FILE,
  }
  try {
    mkdirSync(join(oldDsh, 'sessions', 'workspace'), { recursive: true })
    mkdirSync(join(oldEvo, 'plugins'), { recursive: true })
    writeFileSync(join(oldDsh, 'sessions', 'workspace', 'session.jsonl'), '{"type":"message"}\n')
    writeFileSync(join(oldEvo, 'plugins', 'scheduler.json'), '{"tasks":[]}\n')
    process.env.DSH_HOME = oldDsh
    process.env.EVORESEARCH_PATHS_CONFIG = config
    process.env.EVORESEARCH_RESTART_FILE = restart

    const result = applyDataPaths(oldEvo, { evoresearchRoot: newRoot }, 'migrate')
    assert.equal(result.sourcePreserved, true)
    assert.equal(result.restartRequired, true)
    assert.equal(result.restartRequested, true)
    assert.equal(readFileSync(join(newRoot, 'sessions', 'workspace', 'session.jsonl'), 'utf8'), '{"type":"message"}\n')
    assert.equal(readFileSync(join(newRoot, 'plugins', 'scheduler.json'), 'utf8'), '{"tasks":[]}\n')
    assert.equal(existsSync(join(oldDsh, 'sessions', 'workspace', 'session.jsonl')), true)
    assert.equal(existsSync(join(oldEvo, 'plugins', 'scheduler.json')), true)
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { evoresearchRoot: newRoot })
    assert.equal(existsSync(restart), true)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(base, { recursive: true, force: true })
  }
})

test('reuse creates the target but never copies over existing data', () => {
  const base = mkdtempSync(join(tmpdir(), 'evoresearch-data-reuse-'))
  const oldDsh = join(base, 'old-dsh')
  const oldEvo = join(base, 'old-evo')
  const target = join(base, 'target')
  const config = join(base, 'paths.json')
  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    EVORESEARCH_PATHS_CONFIG: process.env.EVORESEARCH_PATHS_CONFIG,
    EVORESEARCH_RESTART_FILE: process.env.EVORESEARCH_RESTART_FILE,
  }
  try {
    mkdirSync(oldDsh, { recursive: true })
    mkdirSync(oldEvo, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep.txt'), 'target')
    process.env.DSH_HOME = oldDsh
    process.env.EVORESEARCH_PATHS_CONFIG = config
    delete process.env.EVORESEARCH_RESTART_FILE
    const result = applyDataPaths(oldEvo, { evoresearchRoot: target }, 'reuse')
    assert.equal(result.copiedEntries, 0)
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'target')
    assert.equal(result.restartRequested, false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(base, { recursive: true, force: true })
  }
})

test('migration refuses to overwrite conflicting files', () => {
  const base = mkdtempSync(join(tmpdir(), 'evoresearch-data-conflict-'))
  const source = join(base, 'source')
  const target = join(base, 'target')
  try {
    mkdirSync(source, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(source, 'copied-before-conflict.txt'), 'should-not-copy')
    writeFileSync(join(source, 'settings.yaml'), 'new')
    writeFileSync(join(target, 'settings.yaml'), 'different')
    assert.throws(() => copyTreeNoOverwrite(source, target), /迁移冲突/)
    assert.equal(readFileSync(join(target, 'settings.yaml'), 'utf8'), 'different')
    assert.equal(existsSync(join(target, 'copied-before-conflict.txt')), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('path snapshot reports the runtime roots, not only bootstrap values', () => {
  const previous = process.env.DSH_HOME
  const dataRoot = mkdtempSync(join(tmpdir(), 'evoresearch-data-snapshot-'))
  try {
    process.env.DSH_HOME = join(dataRoot, 'runtime-dsh')
    const snapshot = getDataPaths(join(dataRoot, 'runtime-evo'))
    assert.equal(snapshot.evoresearchRoot, join(dataRoot, 'runtime-evo'))
    assert.equal(snapshot.dshHome, join(dataRoot, 'runtime-dsh'))
    assert.equal(snapshot.evoResearchDataRoot, join(dataRoot, 'runtime-evo'))
    assert.equal(snapshot.pluginStateRoot, join(dataRoot, 'runtime-evo', 'plugins'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('clear locations use the same runtime roots as the clear implementation', () => {
  const previous = process.env.DSH_HOME
  const base = mkdtempSync(join(tmpdir(), 'evoresearch-clear-paths-'))
  const dataRoot = join(base, 'evo-root')
  const dshHome = join(base, 'dsh-home')
  try {
    process.env.DSH_HOME = dshHome
    const paths = getDataClearPaths(dataRoot)
    assert.equal(paths.projects[0]?.path, join(dataRoot, 'projects', '<project-name>'))
    assert.equal(paths.projects[1]?.path, join(dshHome, 'sessions', '<workspace>'))
    assert.equal(paths.projects[2]?.path, join(dataRoot, 'plugins', 'memories'))
    assert.equal(paths.models[0]?.path, join(dataRoot, 'plugins', 'model-settings.json'))
    assert.equal(paths.models[1]?.path, join(dshHome, 'settings.yaml'))
    assert.equal(paths.prefs[0]?.path, join(dataRoot, 'plugins', 'client-state.json'))
    assert.equal(paths.prefs[1]?.effect, 'browser-storage')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(base, { recursive: true, force: true })
  }
})
