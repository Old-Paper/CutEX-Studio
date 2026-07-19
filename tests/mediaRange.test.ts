import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../src/shared/mediaRange'

describe('local media byte ranges', () => {
  it('parses an explicit browser seek range', () => {
    expect(parseByteRange('bytes=100-499', 1_000)).toEqual({ start: 100, end: 499 })
  })

  it('supports open and suffix ranges', () => {
    expect(parseByteRange('bytes=800-', 1_000)).toEqual({ start: 800, end: 999 })
    expect(parseByteRange('bytes=-200', 1_000)).toEqual({ start: 800, end: 999 })
  })

  it('rejects ranges outside the file', () => {
    expect(parseByteRange('bytes=1000-', 1_000)).toBeNull()
    expect(parseByteRange('invalid', 1_000)).toBeNull()
  })
})
