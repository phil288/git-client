import type { FileContent } from '@shared/types'

export type Encoding = FileContent['encoding']

/** Heuristic used by git too: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/**
 * Decodes file bytes without silently changing them: BOMs are detected and
 * remembered, invalid UTF-8 falls back to latin1 (a lossless byte mapping), so
 * encodeText(decode(buf)) === buf.
 */
export function decodeText(buf: Buffer): { text: string; encoding: Encoding; binary: boolean } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8bom', binary: false }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le', binary: false }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return { text: swapped.toString('utf16le'), encoding: 'utf16be', binary: false }
  }
  if (looksBinary(buf)) return { text: '', encoding: 'utf8', binary: true }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf8', binary: false }
  } catch {
    return { text: buf.toString('latin1'), encoding: 'latin1', binary: false }
  }
}

export function encodeText(text: string, encoding: Encoding): Buffer {
  switch (encoding) {
    case 'utf8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'utf16be': {
      const b = Buffer.from(text, 'utf16le')
      b.swap16()
      return Buffer.concat([Buffer.from([0xfe, 0xff]), b])
    }
    case 'latin1':
      return Buffer.from(text, 'latin1')
    default:
      return Buffer.from(text, 'utf8')
  }
}
