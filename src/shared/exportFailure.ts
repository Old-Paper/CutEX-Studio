export function exportFailureKind(error: unknown): 'io' | 'gpu' | 'timing' | 'other' {
  const message = String(error)
  if (/ENOSPC|EACCES|EPERM|ENOENT|no space left|permission denied|access is denied|read-only file system|error opening output|disk full/i.test(message)) return 'io'
  if (/cannot load (?:nvcuda|libcuda)|no nvenc capable|driver.*(?:nvenc|cuda)|nvenc.*(?:unavailable|not supported)|(?:qsv|mfx|amf).*?(?:failed|error|unsupported|not found)|(?:failed|error).*?(?:qsv|mfx|amf)|unknown encoder.*(?:nvenc|qsv|amf)|no capable devices found|initializeencoder failed|cannot init cuda/i.test(message)) return 'gpu'
  if (/concat.*(?:invalid|error|failed)|non.monoton|invalid.*timestamp|CUTEX_OUTPUT_INVALID/i.test(message)) return 'timing'
  return 'other'
}
