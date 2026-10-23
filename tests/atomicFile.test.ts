import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { atomicWrite } from '../src/main/project/atomicFile'

it('saves atomically, retains the previous version and leaves no partial file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutex-atomic-'))
  try {
    const path = join(dir, '中文工程.cutex.json')
    await atomicWrite(path, 'first', true)
    await atomicWrite(path, 'second', true)
    expect(await readFile(path, 'utf8')).toBe('second')
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('first')
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
