import type { ChatGraphLayoutRequest, ChatGraphLayoutResponse, LayoutAlgorithmName } from './chatgraph-layout-worker'
import { clientStateGet } from './client-state'

/**
 * ELK must run on the main thread: inside a dedicated Worker its bundled
 * bootstrap cannot construct its inner compute worker ("X is not a
 * constructor"), which silently degraded every layout to the single-column
 * fallback. elkjs spawns its own worker for the heavy computation, so the
 * extra wrapper only broke things.
 */
export function runChatGraphLayout(request: ChatGraphLayoutRequest): Promise<ChatGraphLayoutResponse> {
  return import('./chatgraph-layout-worker').then(({ layoutGraph }) => layoutGraph(request))
}

/** 图谱自动布局算法偏好（设置面板可切换；持久化于 client-state.json）。 */
export type GraphLayoutAlgorithm = LayoutAlgorithmName

export const GRAPH_LAYOUT_ALGO_STATE_KEY = 'evoresearch-graph-layout-algo'

/** 读取当前算法偏好：仅接受 'relax' / 'dagre'，其余（含未设置）回退默认 'tree'。 */
export function getGraphLayoutAlgorithm(): GraphLayoutAlgorithm {
  try { const v = clientStateGet(GRAPH_LAYOUT_ALGO_STATE_KEY); return v === 'relax' || v === 'dagre' ? v : 'tree' } catch { return 'tree' }
}
