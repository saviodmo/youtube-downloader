'use strict'

/**
 * YouTube Downloader — processo principal (Electron)
 * Responsabilidades: janela, diálogos nativos, config persistida e execução do yt-dlp.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeTheme } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn, execFile, execFileSync } = require('node:child_process')

const isWindows = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Caminhos
// ---------------------------------------------------------------------------

const BIN_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, 'bin')

const YTDLP_PATH = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp')
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

let ffmpegDirCache
function findFfmpegDir() {
  if (ffmpegDirCache !== undefined) return ffmpegDirCache

  // 1) ffmpeg empacotado junto do app
  const bundled = path.join(BIN_DIR, isWindows ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(bundled)) {
    ffmpegDirCache = BIN_DIR
    return ffmpegDirCache
  }

  // 2) ffmpeg no PATH do sistema
  try {
    const cmd = isWindows ? 'where' : 'which'
    const out = execFileSync(cmd, ['ffmpeg'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    if (first && fs.existsSync(first)) {
      ffmpegDirCache = path.dirname(first)
      return ffmpegDirCache
    }
  } catch {
    /* segue para os fallbacks */
  }

  // 3) locais comuns
  const fallbacks = isWindows
    ? ['C:\\ffmpeg\\bin', 'C:\\Program Files\\ffmpeg\\bin', 'C:\\ProgramData\\chocolatey\\bin']
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
  for (const dir of fallbacks) {
    if (fs.existsSync(path.join(dir, isWindows ? 'ffmpeg.exe' : 'ffmpeg'))) {
      ffmpegDirCache = dir
      return ffmpegDirCache
    }
  }

  ffmpegDirCache = null
  return null
}

// ---------------------------------------------------------------------------
// Configuração persistida (%APPDATA%/youtube-downloader/config.json)
// ---------------------------------------------------------------------------

const THEME_BACKGROUND = {
  dark: '#1e1f22',
  light: '#f7f8fa',
}

function readConfig() {
  const defaults = {
    folder: app.getPath('downloads'),
    mode: 'video',
    videoQuality: 'best',
    audioFormat: 'mp3',
    audioQuality: '320',
    // primeira abertura: acompanha o tema do Windows
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  }

  let parsed = {}
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}
  } catch {
    parsed = {}
  }

  // compatibilidade com a versão antiga (que guardava apenas "quality")
  if (!parsed.mode && typeof parsed.quality === 'string') {
    if (parsed.quality === 'mp3') {
      parsed.mode = 'audio'
      parsed.audioFormat = 'mp3'
    } else {
      parsed.mode = 'video'
      parsed.videoQuality = parsed.quality
    }
  }

  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)

  return {
    folder: typeof parsed.folder === 'string' && parsed.folder ? parsed.folder : defaults.folder,
    mode: pick(parsed.mode, ['video', 'audio'], defaults.mode),
    videoQuality: pick(parsed.videoQuality, ['best', '1080', '720', '480', '360'], defaults.videoQuality),
    audioFormat: pick(parsed.audioFormat, ['mp3', 'wav', 'm4a', 'flac'], defaults.audioFormat),
    audioQuality: pick(parsed.audioQuality, ['320', '256', '192', '128'], defaults.audioQuality),
    theme: pick(parsed.theme, ['dark', 'light'], defaults.theme),
  }
}

function writeConfig(patch) {
  const current = readConfig()
  const next = { ...current }

  if (typeof patch?.folder === 'string' && patch.folder) next.folder = patch.folder
  if (patch?.mode === 'video' || patch?.mode === 'audio') next.mode = patch.mode
  if (['best', '1080', '720', '480', '360'].includes(patch?.videoQuality)) {
    next.videoQuality = patch.videoQuality
  }
  if (['mp3', 'wav', 'm4a', 'flac'].includes(patch?.audioFormat)) next.audioFormat = patch.audioFormat
  if (['320', '256', '192', '128'].includes(patch?.audioQuality)) next.audioQuality = patch.audioQuality
  if (patch?.theme === 'dark' || patch?.theme === 'light') next.theme = patch.theme

  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* se não der para salvar, o app continua funcionando com o valor em memória */
  }
  return next
}

// ---------------------------------------------------------------------------
// Utilidades de processo
// ---------------------------------------------------------------------------

/** Executa um comando e devolve { code, stdout, stderr }. */
function run(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      ...options,
    })

    let stdout = ''
    let stderr = ''
    const limit = 12 * 1024 * 1024

    child.stdout?.on('data', (d) => {
      if (stdout.length < limit) stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d) => {
      if (stderr.length < limit) stderr += d.toString('utf8')
    })

    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

function validateUrl(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'Cole um link para começar.' }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: 'Esse link não parece válido. Ex.: https://www.youtube.com/watch?v=...' }
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, error: 'O link precisa começar com http:// ou https://' }
  }
  return { ok: true, url: url.toString() }
}

// ---------------------------------------------------------------------------
// Metadados do vídeo (pré-visualização)
// ---------------------------------------------------------------------------

async function fetchVideoInfo(rawUrl) {
  const check = validateUrl(rawUrl)
  if (!check.ok) return check

  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--socket-timeout', '20',
  ]
  const ffmpegDir = findFfmpegDir()
  if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir)
  args.push('--', check.url)

  const { code, stdout, stderr } = await run(YTDLP_PATH, args)

  if (code !== 0) {
    const message = cleanError(stderr) || 'Não foi possível ler esse link.'
    return { ok: false, error: message }
  }

  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    return { ok: false, error: 'Resposta inesperada do motor de download.' }
  }

  return {
    ok: true,
    title: data.title || 'Vídeo sem título',
    channel: data.channel || data.uploader || '',
    duration: Number(data.duration) || 0,
    thumbnail: data.thumbnail || '',
    isLive: Boolean(data.is_live),
    webpageUrl: data.webpage_url || check.url,
  }
}

/** Transforma o stderr do yt-dlp em uma mensagem curta e legível. */
function cleanError(stderr) {
  if (!stderr) return ''
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('WARNING:'))

  const errLine = lines.find((l) => l.startsWith('ERROR:'))
  const chosen = errLine || lines[lines.length - 1] || ''
  return chosen.replace(/^ERROR:\s*/i, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 400)
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function videoFormatFor(quality) {
  switch (quality) {
    case '1080':
    case '720':
    case '480':
    case '360':
      return {
        selector: [
          `bv*[height<=${quality}][vcodec^=avc1]+ba[ext=m4a]`,
          `bv*[height<=${quality}]+ba`,
          `b[height<=${quality}]`,
        ].join('/'),
        merge: true,
      }
    case 'best':
    default:
      return {
        selector: ['bv*[vcodec^=avc1]+ba[ext=m4a]', 'bv*+ba', 'b'].join('/'),
        merge: true,
      }
  }
}

/** Formatos de áudio que passam por reencode e aceitam taxa em kbps. */
const LOSSY_AUDIO = new Set(['mp3', 'm4a'])

function buildDownloadArgs({
  url,
  folder,
  mode,
  videoQuality,
  audioFormat,
  audioQuality,
  ffmpegDir,
}) {
  const isAudio = mode === 'audio'

  const args = [
    '--no-colors',
    '--newline',
    '--no-warnings',
    '--no-playlist',
    '--windows-filenames',
    '--trim-filenames', '180',
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '4',
    '--progress-template',
    'download:PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|' +
      '%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.percent)s',
    '-o', path.join(folder, '%(title)s.%(ext)s'),
  ]

  if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir)

  if (isAudio) {
    // melhor faixa de áudio disponível, convertida para o formato escolhido
    args.push('-f', 'ba/b', '-x', '--audio-format', audioFormat)
    if (LOSSY_AUDIO.has(audioFormat)) {
      args.push('--audio-quality', `${audioQuality}K`)
    }
    args.push('--embed-metadata')
  } else {
    const fmt = videoFormatFor(videoQuality)
    args.push('-f', fmt.selector)
    if (fmt.merge) args.push('--merge-output-format', 'mp4')
  }

  args.push('--', url)

  return { args, audioOnly: isAudio }
}

let activeJob = null

async function startDownload(payload, sender) {
  const check = validateUrl(payload?.url)
  if (!check.ok) return check

  if (activeJob) return { ok: false, error: 'Já existe um download em andamento.' }

  let folder = typeof payload.folder === 'string' && payload.folder ? payload.folder : readConfig().folder
  try {
    fs.mkdirSync(folder, { recursive: true })
  } catch {
    return { ok: false, error: 'Não foi possível usar essa pasta. Escolha outra.' }
  }

  const cfg = readConfig()
  const mode = payload?.mode === 'audio' ? 'audio' : payload?.mode === 'video' ? 'video' : cfg.mode
  const videoQuality = ['best', '1080', '720', '480', '360'].includes(payload?.videoQuality)
    ? payload.videoQuality
    : cfg.videoQuality
  const audioFormat = ['mp3', 'wav', 'm4a', 'flac'].includes(payload?.audioFormat)
    ? payload.audioFormat
    : cfg.audioFormat
  const audioQuality = ['320', '256', '192', '128'].includes(payload?.audioQuality)
    ? payload.audioQuality
    : cfg.audioQuality

  const ffmpegDir = findFfmpegDir()

  if (!ffmpegDir) {
    return {
      ok: false,
      error: 'FFmpeg não encontrado. Instale o FFmpeg ou coloque ffmpeg.exe na pasta "bin" do app.',
    }
  }

  const { args, audioOnly } = buildDownloadArgs({
    url: check.url,
    folder,
    mode,
    videoQuality,
    audioFormat,
    audioQuality,
    ffmpegDir,
  })

  const startedAt = Date.now()
  const existing = new Set(safeReaddir(folder))

  return new Promise((resolve) => {
    const child = spawn(YTDLP_PATH, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })

    activeJob = { child, cancelled: false }

    let cancelled = false
    let destination = null
    let merged = null
    let audioDest = null
    let lastError = ''
    let lastPercent = 0
    let bufferOut = ''
    let bufferErr = ''
    // yt-dlp baixa vídeo e áudio em fases separadas; acumulamos para a barra
    // não voltar ao zero quando a segunda fase começa.
    let phaseBase = 0

    const emit = (data) => {
      if (!sender.isDestroyed()) sender.send('download:progress', data)
    }

    emit({ stage: 'preparing', percent: 0, downloaded: 0, total: null, speed: null, eta: null })

    const handleLine = (line) => {
      if (!line) return

      if (line.startsWith('PROGRESS|')) {
        const [, status, dl, total, totalEst, speed, eta, percent] = line.split('|')
        const downloaded = num(dl)
        const totalBytes = num(total) || num(totalEst)
        const speedNum = num(speed)

        // Fim de uma fase (vídeo ou áudio): acumula para a próxima começar de onde parou
        if (status === 'finished') {
          phaseBase += totalBytes || downloaded || 0
          emit({
            stage: 'processing',
            percent: 100,
            downloaded: phaseBase,
            total: phaseBase,
            speed: null,
            eta: null,
          })
          return
        }

        const overallTotal = totalBytes ? phaseBase + totalBytes : null
        const overallDownloaded = downloaded !== null ? phaseBase + downloaded : null

        let pct = num(percent)
        if (pct === null && overallTotal && overallDownloaded !== null && overallTotal > 0) {
          pct = (overallDownloaded / overallTotal) * 100
        }
        if (pct !== null) lastPercent = pct

        emit({
          stage: 'downloading',
          percent: pct !== null ? Math.max(0, Math.min(100, pct)) : lastPercent,
          downloaded: overallDownloaded,
          total: overallTotal,
          speed: speedNum,
          eta: num(eta),
        })
        return
      }

      if (line.startsWith('[download] Destination:')) {
        destination = line.slice('[download] Destination:'.length).trim()
        emit({ stage: 'downloading', percent: lastPercent, label: 'Baixando...' })
        return
      }

      if (line.startsWith('[Merger] Merging formats into')) {
        merged = line.replace(/^\[Merger\] Merging formats into\s*/i, '').replace(/^"|"$/g, '').trim()
        emit({ stage: 'processing', percent: 100, label: 'Juntando vídeo e áudio...' })
        return
      }

      if (line.startsWith('[ExtractAudio] Destination:')) {
        audioDest = line.slice('[ExtractAudio] Destination:'.length).trim()
        emit({ stage: 'processing', percent: 100, label: 'Convertendo para MP3...' })
        return
      }

      if (line.startsWith('ERROR:')) {
        lastError = line
        return
      }

      if (/^\[(youtube|info)\]/i.test(line)) {
        emit({ stage: 'preparing', percent: 0, detail: friendlyStage(line), log: line })
      }
    }

    const pump = (chunk, which) => {
      const text = chunk.toString('utf8')
      if (which === 'out') {
        bufferOut += text
        const parts = bufferOut.split(/\r?\n/)
        bufferOut = parts.pop() ?? ''
        parts.forEach(handleLine)
      } else {
        bufferErr += text
        const parts = bufferErr.split(/\r?\n/)
        bufferErr = parts.pop() ?? ''
        parts.forEach(handleLine)
      }
    }

    child.stdout.on('data', (c) => pump(c, 'out'))
    child.stderr.on('data', (c) => pump(c, 'err'))

    child.on('error', (err) => {
      activeJob = null
      resolve({ ok: false, error: String(err.message || err) })
    })

    child.on('close', (code) => {
      activeJob = null
      if (bufferOut) handleLine(bufferOut)
      if (bufferErr) handleLine(bufferErr)

      const elapsedMs = Date.now() - startedAt

      if (cancelled) {
        cleanupPartials(folder, startedAt, existing)
        emit({ stage: 'cancelled', percent: 0, label: 'Download cancelado.' })
        return resolve({ ok: false, cancelled: true, error: 'Download cancelado.' })
      }

      if (code !== 0) {
        const message = cleanError(lastError || bufferErr) || 'Falha ao baixar o vídeo.'
        emit({ stage: 'error', percent: 0, error: message })
        return resolve({ ok: false, error: message })
      }

      const filePath = pickResultFile({ merged, audioDest, destination, folder, existing, startedAt })

      emit({
        stage: 'done',
        percent: 100,
        downloaded: filePath ? safeSize(filePath) : null,
        total: filePath ? safeSize(filePath) : null,
        speed: null,
        eta: 0,
        elapsedMs,
        filePath,
        audioOnly,
      })

      resolve({
        ok: true,
        filePath,
        elapsedMs,
        audioOnly,
        size: filePath ? safeSize(filePath) : null,
      })
    })

    activeJob.setCancel = () => {
      cancelled = true
      activeJob.cancelled = true
      if (isWindows && child.pid) {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      } else {
        child.kill('SIGKILL')
      }
    }
  })
}

/** Traduz as mensagens do yt-dlp em algo amigável para o usuário. */
function friendlyStage(line) {
  const l = line.toLowerCase()
  if (l.includes('extracting url') || l.includes('downloading webpage') || l.includes('api json')) {
    return 'Conectando ao YouTube…'
  }
  if (l.includes('player') || l.includes('js challenge') || l.includes('jsc:')) {
    return 'Preparando o player…'
  }
  if (l.includes('m3u8') || l.includes('manifest') || l.includes('format(s)')) {
    return 'Selecionando a melhor qualidade…'
  }
  return 'Preparando download…'
}

/** Remove restos de um download cancelado (arquivos .part e fragmentos). */
function cleanupPartials(folder, startedAt, existing) {
  const fragmentRe = /\.(part|ytdl|temp)$|\.f\d{2,4}\.(mp4|m4a|webm|mkv|opus|aac|mp3)$/i
  for (const name of safeReaddir(folder)) {
    if (existing.has(name) || !fragmentRe.test(name)) continue
    const file = path.join(folder, name)
    try {
      const meta = fs.statSync(file)
      if (meta.isFile() && meta.mtimeMs >= startedAt - 5000) fs.unlinkSync(file)
    } catch {
      /* arquivo em uso — o Windows libera depois */
    }
  }
}

function num(value) {
  if (value === undefined || value === null) return null
  const v = String(value).trim()
  if (!v || v === 'NA' || v === 'None') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}


function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function safeSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return null
  }
}

/**
 * Descobre o arquivo final. Usa as pistas do log e, se necessário,
 * procura na pasta por um arquivo novo.
 */
function pickResultFile({ merged, audioDest, destination, folder, existing, startedAt }) {
  const candidates = [merged, audioDest, destination].filter(Boolean)
  // Alguns clientes reportam o "Destination" referente à pasta temporária (.part),
  // então removemos sufixos conhecidos antes de testar.
  for (const candidate of candidates) {
    const clean = candidate.replace(/\.part$/, '').replace(/\.ytdl$/, '')
    if (fs.existsSync(clean)) return clean
  }

  const since = startedAt - 5000
  const found = safeReaddir(folder)
    .filter((name) => !existing.has(name))
    .filter((name) => !/\.(part|ytdl|temp)$/i.test(name))
    .map((name) => path.join(folder, name))
    .map((file) => ({ file, meta: fs.existsSync(file) ? fs.statSync(file) : null }))
    .filter((entry) => entry.meta && entry.meta.isFile() && entry.meta.mtimeMs >= since)
    .sort((a, b) => b.meta.mtimeMs - a.meta.mtimeMs)

  return found.length ? found[0].file : null
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------

let mainWindow = null

/** Mantém o tema nativo (diálogos, sombras) e o fundo da janela em sincronia. */
function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark'
  nativeTheme.themeSource = value
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(THEME_BACKGROUND[value])
  }
  return value
}

function createWindow() {
  const cfg = readConfig()
  const theme = applyTheme(cfg.theme)

  mainWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: THEME_BACKGROUND[theme],
    title: 'YouTube Downloader',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--app-theme=${theme}`],
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', { maximized: true }))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', { maximized: false }))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Links externos abrem no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('app:info', async () => {
  const cfg = readConfig()
  let engine = 'não encontrado'
  if (fs.existsSync(YTDLP_PATH)) {
    const { code, stdout } = await run(YTDLP_PATH, ['--version'])
    if (code === 0) engine = stdout.trim()
  }
  return {
    version: app.getVersion(),
    engine,
    ffmpeg: findFfmpegDir(),
    folder: cfg.folder,
    mode: cfg.mode,
    videoQuality: cfg.videoQuality,
    audioFormat: cfg.audioFormat,
    audioQuality: cfg.audioQuality,
    theme: applyTheme(cfg.theme),
    downloadsPath: app.getPath('downloads'),
    os: `${os.type()} ${os.release()}`,
  }
})

ipcMain.handle('config:save', (_e, patch) => {
  const next = writeConfig(patch || {})
  applyTheme(next.theme)
  return next
})

ipcMain.handle('dialog:chooseFolder', async () => {
  const cfg = readConfig()
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha onde salvar os downloads',
    defaultPath: cfg.folder,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Salvar aqui',
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false }
  const folder = result.filePaths[0]
  writeConfig({ folder })
  return { ok: true, folder }
})

ipcMain.handle('video:info', (_e, url) => fetchVideoInfo(url))

ipcMain.handle('download:start', (event, payload) => startDownload(payload, event.sender))

ipcMain.handle('download:cancel', () => {
  if (activeJob?.setCancel) activeJob.setCancel()
  return { ok: true }
})

ipcMain.handle('shell:openFolder', (_e, folder) => {
  if (folder && fs.existsSync(folder)) shell.openPath(folder)
  return { ok: true }
})

ipcMain.handle('shell:showFile', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
  else if (filePath) shell.openPath(path.dirname(filePath))
  return { ok: true }
})

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
  return { ok: true }
})

ipcMain.handle('clipboard:read', () => clipboard.readText())

ipcMain.handle('engine:update', async () => {
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  const tmp = `${YTDLP_PATH}.new`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return { ok: false, error: `Falha ao baixar (HTTP ${res.status}).` }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, YTDLP_PATH)
    const { stdout } = await run(YTDLP_PATH, ['--version'])
    return { ok: true, engine: stdout.trim() }
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignora */
    }
    return { ok: false, error: String(err.message || err) }
  }
})

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (activeJob?.setCancel) activeJob.setCancel()
})
