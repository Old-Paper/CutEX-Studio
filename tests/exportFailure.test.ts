import { expect, it } from 'vitest'
import { exportFailureKind } from '../src/shared/exportFailure'
it('never treats disk or permissions failures as a reason to retry on CPU', () => {
  for (const error of ['No space left on device', 'EACCES: h264_nvenc', 'Permission denied', 'Error opening output file']) expect(exportFailureKind(error)).toBe('io')
})
it('only retries recognized hardware or timing errors', () => {
  expect(exportFailureKind('Cannot load nvcuda.dll')).toBe('gpu')
  expect(exportFailureKind('Error initializing an MFX session')).toBe('gpu')
  expect(exportFailureKind('[enc:h264_nvenc @ 00001] Error while opening encoder - maybe incorrect parameters')).toBe('gpu')
  expect(exportFailureKind('[enc:h264_nvenc] Error while opening encoder: Permission denied')).toBe('io')
  expect(exportFailureKind('CUTEX_OUTPUT_INVALID')).toBe('timing')
  expect(exportFailureKind('Unknown error: -1')).toBe('other')
})
