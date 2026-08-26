import type { ChatGraphLayoutRequest, ChatGraphLayoutResponse } from './chatgraph-layout-worker'

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
