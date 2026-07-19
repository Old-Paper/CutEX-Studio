import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function appendLog(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, text, 'utf8')
}
