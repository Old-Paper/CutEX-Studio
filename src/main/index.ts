import { app, BrowserWindow, protocol } from 'electron'
import { extname, join } from 'node:path'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { registerIpc } from './ipc/register'
import { parseByteRange } from '../shared/mediaRange'

// Keep using the legacy data folder so recent projects and logs survive the product rename.
app.setPath('userData', join(app.getPath('appData'), 'dubcut-studio'))
app.setName('CutEX Studio')

protocol.registerSchemesAsPrivileged([{ scheme: 'local-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1540, height: 960, minWidth: 1120, minHeight: 720,
    backgroundColor: '#090b10', title: 'CutEX Studio', titleBarStyle: 'hidden', titleBarOverlay: { color: '#090b10', symbolColor: '#aab0bc', height: 42 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  registerIpc(window)
  const capturePath = process.env.CUTEX_CAPTURE_PATH ?? process.env.DUBCUT_CAPTURE_PATH
  if (capturePath) window.webContents.once('did-finish-load', () => {
    setTimeout(() => void window.webContents.capturePage().then((image) => writeFile(capturePath, image.toPNG())).finally(() => app.quit()), 1200)
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  protocol.handle('local-media', async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.slice(1))
    const file = await stat(filePath)
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
    }
    const contentType = mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const requestedRange = request.headers.get('range')
    const range = requestedRange ? parseByteRange(requestedRange, file.size) : null
    if (requestedRange && !range) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}`, 'Accept-Ranges': 'bytes' } })
    }
    const start = range?.start ?? 0
    const end = range?.end ?? file.size - 1
    const headers = {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': contentType,
      'Content-Length': String(Math.max(0, end - start + 1)),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {})
    }
    if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })
    const body = Readable.toWeb(createReadStream(filePath, { start, end }))
    return new Response(body as never, { status: range ? 206 : 200, headers })
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
