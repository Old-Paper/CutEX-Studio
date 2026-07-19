export interface ByteRange {
  start: number
  end: number
}

export function parseByteRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || size <= 0) return null
  const startText = match[1]
  const endText = match[2]
  if (!startText && !endText) return null
  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(startText)
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return null
  return { start, end }
}
