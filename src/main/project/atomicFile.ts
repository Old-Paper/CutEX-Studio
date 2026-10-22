import { copyFile, open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** Same-directory replace: a failed write never truncates the existing project. */
export async function atomicWrite(path: string, contents: string, backup = false): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(contents, 'utf8'); await file.sync() } finally { await file.close() }
    if (backup) {
      try { await copyFile(path, `${path}.bak`) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}
