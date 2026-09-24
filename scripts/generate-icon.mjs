// Generates build/icon.png (512x512) without external tools: a rounded
// gradient square with a white "branch" glyph. electron-builder derives the
// Linux icon set and the Windows .ico from this file.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const S = 512
const px = new Float32Array(S * S * 4)

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const mix = (a, b, t) => a + (b - a) * t

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay))
  return Math.hypot(pax - bax * h, pay - bay * h)
}
// Quadratic bezier approximated by segments.
const curve = []
{
  const [p0, p1, p2] = [[342, 212], [342, 318], [176, 336]]
  const N = 24
  for (let i = 0; i <= N; i++) {
    const t = i / N
    curve.push([
      (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
    ])
  }
}

function blend(i, r, g, b, a) {
  const da = px[i + 3]
  const oa = a + da * (1 - a)
  if (oa === 0) return
  px[i] = (r * a + px[i] * da * (1 - a)) / oa
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa
  px[i + 3] = oa
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    const fx = x + 0.5, fy = y + 0.5
    // Background tile with diagonal gradient (#3574f0 -> #7b4ff0).
    const bg = clamp(0.5 - sdRoundRect(fx, fy, 256, 256, 232, 232, 96))
    if (bg > 0) {
      const t = clamp((fx + fy) / (2 * S))
      blend(i, mix(0x35, 0x7b, t) / 255, mix(0x74, 0x4f, t) / 255, mix(0xf0, 0xf0, t) / 255, bg)
    }
    // Glyph: trunk, branch curve, three commits.
    let d = sdSegment(fx, fy, 176, 150, 176, 362) - 16
    for (let k = 0; k < curve.length - 1; k++) {
      d = Math.min(d, sdSegment(fx, fy, curve[k][0], curve[k][1], curve[k + 1][0], curve[k + 1][1]) - 16)
    }
    for (const [cx, cy] of [[176, 150], [176, 362], [342, 190]]) d = Math.min(d, Math.hypot(fx - cx, fy - cy) - 46)
    const glyph = clamp(0.5 - d) * bg
    if (glyph > 0) blend(i, 1, 1, 1, glyph)
    // Hollow commit centres in the tile colour.
    for (const [cx, cy] of [[176, 150], [176, 362], [342, 190]]) {
      const hole = clamp(0.5 - (Math.hypot(fx - cx, fy - cy) - 20)) * bg
      if (hole > 0) {
        const t = clamp((fx + fy) / (2 * S))
        blend(i, mix(0x35, 0x7b, t) / 255, mix(0x74, 0x4f, t) / 255, 0xf0 / 255, hole)
      }
    }
  }
}

// Encode RGBA PNG.
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  for (let x = 0; x < S * 4; x++) raw[y * (S * 4 + 1) + 1 + x] = Math.round(clamp(px[y * S * 4 + x]) * 255)
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`build/icon.png written (${png.length} bytes)`)
