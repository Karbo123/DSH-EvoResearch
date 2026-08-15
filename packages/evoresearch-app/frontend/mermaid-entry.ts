/**
 * Mermaid 惰性加载入口（独立 bundle：dist/assets/mermaid.js）。
 * 由客户端按需 <script> 加载（流式期间不加载，回答结束后绘制，§31.5）。
 */
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  fontFamily: 'inherit',
})

;(window as any).__evoMermaid = mermaid
