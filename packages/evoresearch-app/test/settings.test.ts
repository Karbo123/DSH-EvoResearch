import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDataClearPathsFallback, normalizeDataPathsSnapshot } from '../src/client/settings'

test('数据路径兼容旧接口响应并立即得到统一根目录', () => {
  const snapshot = normalizeDataPathsSnapshot({
    dshHome: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data',
    evoResearchDataRoot: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data',
    pluginStateRoot: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data\\.evoresearch-data',
  })
  assert.equal(snapshot.evoresearchRoot, 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data')
})

test('数据路径响应缺少全部根目录字段时立即报错而不是永久加载', () => {
  assert.throws(() => normalizeDataPathsSnapshot({ pluginStateRoot: 'C:\\unknown' }), /无法读取当前实际数据位置/)
})

test('旧服务没有清除路径接口时仍按当前进程根目录生成准确清单', () => {
  const paths = buildDataClearPathsFallback({
    dshHome: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data',
    evoResearchDataRoot: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data',
    pluginStateRoot: 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data\\.evoresearch-data',
  })
  assert.equal(paths.projects[0]?.path, 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data\\projects\\<project-name>')
  assert.equal(paths.models[1]?.path, 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data\\settings.yaml')
  assert.equal(paths.prefs[0]?.path, 'D:\\DSH-Research\\.tmp-dev\\.evoresearch-data\\.evoresearch-data\\client-state.json')
})
