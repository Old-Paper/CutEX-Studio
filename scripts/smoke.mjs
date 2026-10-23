import { _electron as electron } from 'playwright-core'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const directory = await mkdtemp(join(tmpdir(), 'cutex-ui-'))
const media = join(directory, 'review.mp4')
const project = join(directory, 'review.cutex.json')
const output = join(directory, 'review-cut.mp4')
const fixture = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=12',
  '-f', 'lavfi', '-i', 'aevalsrc=if(between(t\\,2\\,4)+between(t\\,7\\,9)\\,0\\,0.25*sin(2*PI*440*t)):s=48000:d=12',
  '-c:v', 'libx264', '-c:a', 'aac', media], { windowsHide: true, encoding: 'utf8' })
assert.equal(fixture.status, 0, fixture.stderr)
const app = await electron.launch({ executablePath: process.env.CUTEX_SMOKE_EXE || resolve('node_modules/electron/dist/electron.exe'),
  args: process.env.CUTEX_SMOKE_EXE ? [] : ['.'], env: { ...process.env, CUTEX_USER_DATA: join(directory, 'profile') }, timeout: 60000 })
const failures = []
try {
  // Native dialog selection is injected; actual app handlers, file IO and FFmpeg run normally.
  await app.evaluate(({ dialog, shell }, paths) => {
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [(options ?? _window).title.includes('项目') ? paths.project : paths.media] })
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: (options ?? _window).title.includes('项目') ? paths.project : paths.output })
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false })
    shell.showItemInFolder = () => undefined
  }, { media, project, output })
  const page = await app.firstWindow()
  page.on('pageerror', error => failures.push(error.message))
  await page.getByRole('button', { name: '导入媒体', exact: true }).click()
  await page.getByText(/分析完成，发现 2 个/).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  assert.equal(await page.locator('.cut-segment').count(), 2)
  const track = await page.locator('.timeline-track').boundingBox()
  assert.ok(track)
  await page.mouse.move(track.x + track.width * .1, track.y + track.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * .45, track.y + track.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 5.4) < .2)
  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, -1500)
  await page.keyboard.up('Alt')
  await page.waitForFunction(() => document.querySelector('.timeline-track').clientWidth > document.querySelector('.timeline-viewport').clientWidth * 2)
  const scrollBefore = await page.locator('.timeline-viewport').evaluate(el => el.scrollLeft)
  await page.mouse.wheel(0, 300)
  await page.waitForFunction(before => document.querySelector('.timeline-viewport').scrollLeft > before, scrollBefore)
  // Overview remains an independent whole-file navigation surface at any zoom.
  const overview = await page.locator('.timeline-overview').boundingBox()
  await page.mouse.click(overview.x + overview.width * .23, overview.y + overview.height / 2)
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 2.76) < .2)
  await page.locator('.play-button').click()
  await page.waitForFunction(() => document.querySelector('video').currentTime > 3)
  assert.ok(await page.locator('video').evaluate(el => el.currentTime < 4), 'original review must not skip silence')
  await page.locator('.play-button').click()
  await page.keyboard.press('x')
  await page.getByText('当前片段已恢复保留。', { exact: true }).waitFor()
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: '成片预览', exact: true }).click()
  await page.locator('.play-button').click()
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 3.8)
  await page.locator('.play-button').click()
  await page.getByRole('button', { name: /保存 · 未保存/ }).click()
  await page.getByText('项目已保存。', { exact: true }).waitFor()
  const saved = JSON.parse(await readFile(project, 'utf8'))
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByText('把停顿，变成节奏', { exact: true }).waitFor()
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.cut-segment').length === 2)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('项目已保存。', { exact: true }).waitFor()
  assert.deepEqual(JSON.parse(await readFile(project, 'utf8')).deletionRanges, saved.deletionRanges)
  await page.getByRole('button', { name: '导出成片', exact: true }).click()
  await page.getByRole('button', { name: '开始导出', exact: true }).click()
  await page.getByText(/快速导出完成/).waitFor({ timeout: 60000 })
  assert.ok((await readFile(output)).length > 1000)
  await page.screenshot({ path: join(directory, 'workspace.png') })
  assert.deepEqual(failures, [])
  const report = { result: 'passed', directory, executable: process.env.CUTEX_SMOKE_EXE || 'development Electron',
    checks: ['import + automatic analysis', 'timeline drag/video seek', 'Alt-wheel zoom', 'wheel pan', 'overview navigation', 'original vs edited playback', 'X + undo', 'save/reopen fidelity', 'export through dialog + real FFmpeg'],
    limits: 'Native OS file dialogs were supplied deterministic paths, not clicked manually.' }
  await writeFile(join(directory, 'smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await app.close() }
