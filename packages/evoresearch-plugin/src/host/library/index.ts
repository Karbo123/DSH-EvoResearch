/**
 * 文献索引与检索（LIB-01..08）模块入口。
 *
 * 用法：
 *   import { LibraryIndexer, LibrarySearch } from './library/index.js'
 *   const indexer = new LibraryIndexer({ dataRoot })
 *   const search = new LibrarySearch({ dataRoot })
 *   await indexer.indexLibrary(project, scanDir)
 *   const hits = search.search(project, query)
 *   search.resolveRef(project, { kind: 'paper', paperId })   // LIB-08 图引用
 */
export * from './types.js'
export { LibraryStore, toFtsTokens, escapeLike, projectLibraryDir } from './store.js'
export {
  LibraryIndexer,
  defaultPdfExtractor,
  guessMetadata,
  LIBRARY_DEPENDENCY_SUGGESTIONS,
} from './indexer.js'
export type { LibraryIndexerConfig } from './indexer.js'
export { LibrarySearch } from './search.js'
export type { LibrarySearchConfig } from './search.js'
export {
  parseBibtex,
  generateBibtex,
  normalizeBibTitle,
  parseBibAuthorNames,
  bibYear,
  defaultBibKey,
  findClosingBrace,
} from './bibtex.js'
