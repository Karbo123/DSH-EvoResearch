/**
 * 工作区文件扩展名分类（唯一真相源）。
 *
 * 之前 workspace-files.ts 与 tab-files.ts 各自维护 TEXT_EXT/IMAGE_EXT，
 * 集合有出入（.env 只在一侧、.csv 只在另一侧），同一文件在两个视图
 * 分类不同。这里取并集：.env 与 .csv 都按文本；html/htm 单列 html 类。
 */

/** 文本类扩展名（可在编辑器中打开；.html/.htm 另归 html，不在此列判断）。 */
export const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.css', '.yml', '.yaml', '.rs', '.toml', '.py', '.html', '.htm', '.svg',
  '.xml', '.env', '.sql', '.csv',
])

/** 图片类扩展名（内联预览）。 */
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'])

export type FileKind = 'text' | 'image' | 'pdf' | 'html' | 'other'

/** 按文件名（取扩展名）判断类型；pdf/html 优先于文本类扩展名。 */
export function fileKind(name: string): FileKind {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (TEXT_EXT.has(ext)) return 'text'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'other'
}
