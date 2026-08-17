import type { ChatGraphLayoutRequest, ChatGraphLayoutResponse } from './chatgraph-layout-worker'

/** Replaced by scripts/build-app.mjs with the bundled ELK worker payload. */
declare const __CHATGRAPH_WORKER_SOURCE__: string | undefined

let workerSource: string | null = null

function sourceOfWorker(): string {
  if (workerSource !== null) return workerSource
  workerSource = typeof __CHATGRAPH_WORKER_SOURCE__ === 'string' ? __CHATGRAPH_WORKER_SOURCE__ : ''
  return workerSource
}

export function runChatGraphLayout(request: ChatGraphLayoutRequest): Promise<ChatGraphLayoutResponse> {
  const source = sourceOfWorker()
  if (typeof Worker === 'undefined' || source === '') {
    return import('./chatgraph-layout-worker').then(({ layoutGraph }) => layoutGraph(request))
  }
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ChatGraphLayoutResponse>) => {
      resolve(event.data)
      worker.terminate()
      URL.revokeObjectURL(url)
    }
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Chat Graph layout worker failed'))
      worker.terminate()
      URL.revokeObjectURL(url)
    }
    worker.postMessage(request)
  })
}
