/**
 * 生成应用图标源图（1024×1024 PNG，纯色底 + 简单"E"字标记）。
 * 后续用 `tauri icon` 从源图生成全套平台图标（.ico/.png）。
 * 用法：node scripts/gen-icon.mjs [输出路径]
 *
 * 说明：不依赖图像库——手写 PNG 编码（Node 内置 zlib）。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] ?? join(ROOT, 'desktop', 'icons', 'icon-source.png')
const SIZE = 1024

/** 构造 PNG（RGBA，每行 filter byte 0）。 */
function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      const offset = rowStart + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const idat = deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.alloc(4)
    const crcTable = buildCrcTable()
    crcBuf.writeUInt32BE(crc32(crcTable, Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function buildCrcTable() {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
}

function crc32(table, buf) {
  let c = 0xffffffff
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 像素着色：深蓝底 + 白色 R 形标记（EvoResearch 品牌）。 */
function pixelAt(x, y) {
  // 背景：科研深蓝
  const bg = [31, 58, 147, 255]
  // 边框
  const margin = Math.floor(SIZE * 0.08)
  if (x < margin || y < margin || x >= SIZE - margin || y >= SIZE - margin) return [18, 34, 88, 255]
  const barW = Math.floor(SIZE * 0.1) // R 竖杠宽
  const left = Math.floor(SIZE * 0.26) // R 左侧
  const top = Math.floor(SIZE * 0.2)
  const legH = Math.floor(SIZE * 0.55) // 竖杠+斜腿总高
  const radius = Math.floor(SIZE * 0.18) // R 上部半圆半径
  const cx = left + barW // 半圆圆心 x
  const cy = top + radius // 半圆圆心 y
  const stroke = Math.floor(SIZE * 0.035) // 笔画宽度
  const isRing = (px, py, r) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= stroke
  // 竖杠
  const inStem = x >= left && x < left + barW && y >= top && y < top + legH
  // 半圆环（右半）
  const inLoop = x >= cx && isRing(x, y, radius) && y >= top && y <= top + 2 * radius
  // 斜腿：从竖杠顶向右下到斜腿末端
  const legStartX = left + barW
  const legStartY = top + 2 * radius
  const legEndX = left + barW + radius
  const legEndY = top + legH
  const inLeg = (() => {
    if (x < legStartX || x > legEndX) return false
    const t = (x - legStartX) / (legEndX - legStartX || 1)
    const yLine = legStartY + t * (legEndY - legStartY)
    return Math.abs(y - yLine) <= stroke
  })()
  if (inStem || inLoop || inLeg) return [255, 255, 255, 255]
  return bg
}

const png = encodePng(SIZE, pixelAt)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`[gen-icon] 已生成 ${OUT}（${SIZE}×${SIZE}，${Math.round(png.length / 1024)} KB）`)
