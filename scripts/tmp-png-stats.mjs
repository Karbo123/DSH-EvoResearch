// 临时脚本：解析 PNG 统计颜色分布（判断截图是否全黑/全白/有内容）
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)
// PNG 解析：IHDR 尺寸 + IDAT 解压 + 采样统计
let offset = 8
let width = 0
let height = 0
const idat = []
while (offset < buf.length) {
  const len = buf.readUInt32BE(offset)
  const type = buf.toString('ascii', offset + 4, offset + 8)
  const data = buf.subarray(offset + 8, offset + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
  } else if (type === 'IDAT') {
    idat.push(data)
  } else if (type === 'IEND') {
    break
  }
  offset += 12 + len
}
const raw = inflateSync(Buffer.concat(idat))
const bpp = 4 // RGBA
const stride = width * bpp + 1
console.log(`尺寸: ${width}x${height}, 原始字节: ${raw.length}`)
// 采样统计（每 20 像素取一个）
let black = 0, white = 0, other = 0, total = 0
const colors = new Map()
for (let y = 0; y < height; y += 20) {
  for (let x = 0; x < width; x += 20) {
    const p = y * stride + 1 + x * bpp
    if (p + 3 >= raw.length) continue
    const r = raw[p], g = raw[p + 1], b = raw[p + 2]
    total++
    if (r < 16 && g < 16 && b < 16) black++
    else if (r > 240 && g > 240 && b > 240) white++
    else {
      other++
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      colors.set(key, (colors.get(key) ?? 0) + 1)
    }
  }
}
console.log(`采样: 黑=${black}(${(black / total * 100).toFixed(1)}%) 白=${white}(${(white / total * 100).toFixed(1)}%) 其他=${other}(${(other / total * 100).toFixed(1)}%)`)
const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('主要颜色(量化):', top.map(([k, v]) => `${k}=${v}`).join(', '))
