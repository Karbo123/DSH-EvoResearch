/**
 * DSH 0.1.3 official reference bridge.
 *
 * The app keeps its Milkdown surface, but discovery and canonical reference
 * records come from the Host services exposed by api-session-controller and
 * session-reference.  This module deliberately contains no editor or React
 * state so request cancellation and RemoteResult handling remain testable.
 */
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'

export interface ReferenceRemote {
  fileReferences?: {
    list(agentId: string, query: string, signal?: AbortSignal): Promise<unknown>
  }
  sessionReferenceResolver?: {
    candidates(agentId: string, query: string, signal?: AbortSignal): Promise<unknown>
  }
}

export interface ReferenceCandidateBatch {
  files: FileReferenceCandidate[]
  sessions: SessionReferenceMentionCandidate[]
}

function valuesOf<T>(result: unknown): T[] {
  if (result === null || typeof result !== 'object') return []
  const value = result as { ok?: unknown; value?: unknown }
  if (value.ok !== true || !Array.isArray(value.value)) return []
  return value.value as T[]
}

/** Query both official sources. A failed source degrades independently. */
export async function queryReferenceCandidates(
  remote: ReferenceRemote | null | undefined,
  agentId: string | null | undefined,
  query: string,
  signal?: AbortSignal,
  allowSessions = true,
): Promise<ReferenceCandidateBatch> {
  if (remote === null || remote === undefined || agentId === null || agentId === undefined || agentId === '') {
    return { files: [], sessions: [] }
  }
  if (signal?.aborted === true) return { files: [], sessions: [] }
  const filePromise = remote.fileReferences?.list(agentId, query, signal)
    .then((result) => valuesOf<FileReferenceCandidate>(result))
    .catch(() => []) ?? Promise.resolve([] as FileReferenceCandidate[])
  const sessionPromise = allowSessions
    ? remote.sessionReferenceResolver?.candidates(agentId, query, signal)
      .then((result) => valuesOf<SessionReferenceMentionCandidate>(result))
      .catch(() => []) ?? Promise.resolve([] as SessionReferenceMentionCandidate[])
    : Promise.resolve([] as SessionReferenceMentionCandidate[])
  const [files, sessions] = await Promise.all([filePromise, sessionPromise])
  if (signal?.aborted === true) return { files: [], sessions: [] }
  return { files, sessions }
}

/** Guard used by UI effects before publishing an asynchronous query result. */
export function isCurrentReferenceRequest(
  generation: number,
  currentGeneration: number,
  signal?: AbortSignal,
): boolean {
  return generation === currentGeneration && signal?.aborted !== true
}
