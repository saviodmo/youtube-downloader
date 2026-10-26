'use strict'

const $ = (id) => document.getElementById(id)

const ui = {
  url: $('url'),
  hint: $('hint'),
  paste: $('btnPaste'),

  preview: $('preview'),
  thumbImg: $('thumbImg'),
  thumbSkeleton: $('thumbSkeleton'),
  durationBadge: $('durationBadge'),
  videoTitle: $('videoTitle'),
  videoChannel: $('videoChannel'),
  chipQuality: $('chipQuality'),
  chipStatus: $('chipStatus'),

  folderPath: $('folderPath'),
  choose: $('btnChoose'),
  openFolder: $('btnOpenFolder'),

  mode: $('mode'),
  videoOptions: $('videoOptions'),
  videoQuality: $('videoQuality'),
  audioOptions: $('audioOptions'),
  audioFormat: $('audioFormat'),
  audioQuality: $('audioQuality'),
  audioQualityBlock: $('audioQualityBlock'),
  audioNote: $('audioNote'),

  progressPanel: $('progressPanel'),
  pct: $('pct'),
  progressStatus: $('progressStatus'),
  progressDetail: $('progressDetail'),
  elapsed: $('elapsed'),
  bar: document.querySelector('.bar'),
  barFill: $('barFill'),
  statSpeed: $('statSpeed'),
  statEta: $('statEta'),
  statDownloaded: $('statDownloaded'),
  statTotal: $('statTotal'),
  cancel: $('btnCancel'),

  resultPanel: $('resultPanel'),
  resultFile: $('resultFile'),
  resultMeta: $('resultMeta'),
  showFile: $('btnShowFile'),
  again: $('btnAgain'),

  download: $('btnDownload'),
  downloadLabel: $('btnDownloadLabel'),

  engineInfo: $('engineInfo'),
  ffmpegInfo: $('ffmpegInfo'),
  updateEngine: $('btnUpdateEngine'),

  themeBtn: $('btnTheme'),
  themeIconSun: $('themeIconSun'),
  themeIconMoon: $('themeIconMoon'),
}

const state = {
  folder: '',
  mode: 'video',
  videoQuality: 'best',
  audioFormat: 'mp3',
  audioQuality: '320',
  theme: 'dark',
  info: null,
  downloading: false,
  startedAt: 0,
  timer: null,
  lastFile: null,
  lastElapsed: 0,
  infoSeq: 0,
}

const QUALITY_LABELS = {
  best: 'Melhor qualidade',
  '1080': 'Até 1080p',
  '720': 'Até 720p',
  '480': 'Até 480p',
  '360': 'Até 360p',
}

const AUDIO_FORMAT_LABELS = {
  mp3: 'MP3',
  wav: 'WAV',
  m4a: 'M4A',
  flac: 'FLAC',
}

const LOSSLESS_FORMATS = new Set(['wav', 'flac'])

/** Texto curto do que está selecionado (usado nos chips e no aviso). */
function selectionLabel() {
  if (state.mode === 'audio') {
    const format = AUDIO_FORMAT_LABELS[state.audioFormat] || 'MP3'
    return LOSSLESS_FORMATS.has(state.audioFormat)
      ? `${format} • sem perda`
      : `${format} • ${state.audioQuality} kbps`
  }
  return QUALITY_LABELS[state.videoQuality] || QUALITY_LABELS.best
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = i === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(decimals).replace('.', ',')} ${units[i]}`
}

function fmtSpeed(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—'
  return `${fmtBytes(bps)}/s`
}

function fmtClock(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function fmtDurationWords(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total} s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m} min ${s} s` : `${m} min`
}

function setHint(text, kind = '') {
  ui.hint.textContent = text
  ui.hint.className = `hint ${kind}`.trim()
}

// ---------------------------------------------------------------------------
// Estado visual
// ---------------------------------------------------------------------------

function downloadLabel(busy = state.downloading) {
  const noun = state.mode === 'audio' ? 'áudio' : 'vídeo'
  if (busy) return state.mode === 'audio' ? 'Baixando áudio…' : 'Baixando vídeo…'
  return state.mode === 'audio' ? 'Baixar áudio' : 'Baixar vídeo'
}

function setBusy(busy) {
  state.downloading = busy
  ui.url.disabled = busy
  ui.paste.disabled = busy
  ui.choose.disabled = busy
  document.querySelectorAll('.panel .seg').forEach((b) => (b.disabled = busy))
  ui.download.disabled = busy || !state.info
  ui.downloadLabel.textContent = downloadLabel(busy)
}

/** Mantém os controles de vídeo/áudio sincronizados com o estado. */
function syncSelectionUI() {
  ui.mode.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === state.mode)
  })
  ui.videoQuality.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === state.videoQuality)
  })
  ui.audioFormat.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === state.audioFormat)
  })
  ui.audioQuality.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === state.audioQuality)
  })

  const isAudio = state.mode === 'audio'
  ui.videoOptions.classList.toggle('hidden', isAudio)
  ui.audioOptions.classList.toggle('hidden', !isAudio)

  const lossless = LOSSLESS_FORMATS.has(state.audioFormat)
  ui.audioQualityBlock.classList.toggle('hidden', lossless)
  ui.audioNote.classList.toggle('hidden', !lossless)

  ui.chipQuality.textContent = selectionLabel()
  ui.downloadLabel.textContent = downloadLabel()
}

function persistSelection() {
  window.api.saveConfig({
    mode: state.mode,
    videoQuality: state.videoQuality,
    audioFormat: state.audioFormat,
    audioQuality: state.audioQuality,
  })
}

function showPreviewLoading() {
  ui.preview.classList.remove('hidden')
  ui.thumbImg.classList.add('hidden')
  ui.thumbSkeleton.classList.remove('hidden')
  ui.durationBadge.classList.add('hidden')
  ui.videoTitle.textContent = 'Buscando informações…'
  ui.videoChannel.textContent = 'Aguarde um instante'
  ui.chipQuality.textContent = selectionLabel()
  ui.chipStatus.textContent = 'Analisando link'
  ui.chipStatus.className = 'chip'
}

function fillPreview(info) {
  ui.preview.classList.remove('hidden')
  ui.thumbSkeleton.classList.add('hidden')
  ui.durationBadge.classList.add('hidden')

  if (info.thumbnail) {
    ui.thumbImg.src = info.thumbnail
    ui.thumbImg.classList.remove('hidden')
  }
  if (info.duration > 0) {
    ui.durationBadge.textContent = fmtClock(info.duration)
    ui.durationBadge.classList.remove('hidden')
  }

  ui.videoTitle.textContent = info.title
  ui.videoTitle.title = info.title
  ui.videoChannel.textContent = info.channel || 'Canal desconhecido'
  ui.chipQuality.textContent = selectionLabel()
  ui.chipStatus.textContent = info.isLive ? 'Transmissão ao vivo' : 'Pronto para baixar'
  ui.chipStatus.className = 'chip chip-ok'
}

function hidePreview() {
  ui.preview.classList.add('hidden')
}

// ---------------------------------------------------------------------------
// Carregar informações do vídeo
// ---------------------------------------------------------------------------

let debounceId = null

function scheduleInfoFetch() {
  clearTimeout(debounceId)
  debounceId = setTimeout(() => loadInfo(ui.url.value.trim()), 500)
}

async function loadInfo(rawUrl) {
  const seq = ++state.infoSeq

  if (!rawUrl) {
    state.info = null
    hidePreview()
    setHint('Aceita links de vídeos, Shorts e youtu.be.')
    ui.download.disabled = true
    return
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    state.info = null
    hidePreview()
    setHint('Esse link não parece válido. Ex.: https://www.youtube.com/watch?v=…', 'error')
    ui.download.disabled = true
    return
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    state.info = null
    hidePreview()
    setHint('O link precisa começar com http:// ou https://', 'error')
    ui.download.disabled = true
    return
  }

  state.info = null
  ui.download.disabled = true
  showPreviewLoading()
  setHint('Buscando informações do vídeo…', 'loading')

  const res = await window.api.videoInfo(rawUrl)
  if (seq !== state.infoSeq) return // resposta antiga, ignora

  if (!res.ok) {
    hidePreview()
    setHint(res.error || 'Não foi possível ler esse link.', 'error')
    ui.url.closest('.url-wrap').classList.add('invalid')
    return
  }

  ui.url.closest('.url-wrap').classList.remove('invalid')
  state.info = res
  fillPreview(res)
  setHint('Vídeo encontrado. Escolha a qualidade e clique em baixar.', 'ok')
  if (!state.downloading) ui.download.disabled = false
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function startTimer() {
  stopTimer()
  state.startedAt = Date.now()
  ui.elapsed.textContent = '00:00'
  state.timer = setInterval(() => {
    ui.elapsed.textContent = fmtClock((Date.now() - state.startedAt) / 1000)
  }, 250)
}

function stopTimer() {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}

function resetProgress() {
  ui.pct.textContent = '0'
  ui.barFill.style.width = '0%'
  ui.bar.classList.remove('indeterminate')
  ui.progressStatus.textContent = 'Preparando…'
  ui.progressDetail.textContent = ''
  ui.statSpeed.textContent = '—'
  ui.statEta.textContent = '—'
  ui.statDownloaded.textContent = '—'
  ui.statTotal.textContent = '—'
  ui.elapsed.textContent = '00:00'
  ui.cancel.disabled = false
  ui.cancel.textContent = 'Cancelar download'
}

function handleProgress(data) {
  if (!data) return

  if (data.stage === 'preparing') {
    ui.progressStatus.textContent = 'Preparando download…'
    ui.bar.classList.add('indeterminate')
    if (data.detail) ui.progressDetail.textContent = data.detail
    return
  }

  if (data.stage === 'downloading') {
    ui.bar.classList.remove('indeterminate')
    ui.progressDetail.textContent = ''
    const pct = Number.isFinite(data.percent) ? data.percent : 0
    ui.pct.textContent = String(Math.floor(pct))
    ui.barFill.style.width = `${Math.min(100, Math.max(0, pct))}%`
    ui.progressStatus.textContent = 'Baixando…'
    ui.statSpeed.textContent = fmtSpeed(data.speed)
    ui.statEta.textContent = data.eta ? fmtClock(data.eta) : '—'
    ui.statDownloaded.textContent = fmtBytes(data.downloaded)
    ui.statTotal.textContent = fmtBytes(data.total)
    return
  }

  if (data.stage === 'processing') {
    ui.bar.classList.remove('indeterminate')
    ui.pct.textContent = '100'
    ui.barFill.style.width = '100%'
    ui.progressStatus.textContent = data.label || 'Finalizando arquivo…'
    ui.statEta.textContent = '—'
    ui.statSpeed.textContent = '—'
    return
  }

  if (data.stage === 'cancelled') {
    ui.progressStatus.textContent = 'Download cancelado.'
  }

  if (data.stage === 'error') {
    ui.progressStatus.textContent = data.error || 'Erro no download.'
  }
}

async function startDownload() {
  if (state.downloading) return

  const url = ui.url.value.trim()
  if (!url) {
    setHint('Cole um link do YouTube para começar.', 'error')
    ui.url.focus()
    return
  }
  if (!state.info) {
    await loadInfo(url)
    if (!state.info) return
  }

  ui.resultPanel.classList.add('hidden')
  ui.progressPanel.classList.remove('hidden')
  resetProgress()
  setBusy(true)
  startTimer()
  setHint('Download em andamento…', 'loading')

  const res = await window.api.startDownload({
    url,
    folder: state.folder,
    mode: state.mode,
    videoQuality: state.videoQuality,
    audioFormat: state.audioFormat,
    audioQuality: state.audioQuality,
  })

  stopTimer()

  if (res.ok) {
    state.lastFile = res.filePath || null
    state.lastElapsed = res.elapsedMs || Date.now() - state.startedAt
    ui.elapsed.textContent = fmtClock(state.lastElapsed / 1000)
    ui.pct.textContent = '100'
    ui.bar.classList.remove('indeterminate')
    ui.barFill.style.width = '100%'
    ui.progressStatus.textContent = `Concluído em ${fmtDurationWords(state.lastElapsed)}`

    const name = res.filePath ? res.filePath.split(/[\\/]/).pop() : 'Arquivo salvo'
    ui.resultFile.textContent = name
    ui.resultFile.title = res.filePath || ''
    ui.resultMeta.textContent = `${fmtBytes(res.size)} • ${fmtDurationWords(state.lastElapsed)} • ${state.folder}`
    ui.resultPanel.classList.remove('hidden')
    setHint('Download concluído com sucesso.', 'ok')
    setBusy(false)
    ui.download.disabled = true
    ui.chipStatus.textContent = 'Baixado'
    return
  }

  // erro ou cancelamento
  ui.progressPanel.classList.add('hidden')
  setBusy(false)
  ui.download.disabled = !state.info

  if (res.cancelled) {
    setHint('Download cancelado. Você pode tentar de novo quando quiser.', '')
  } else {
    setHint(res.error || 'Não foi possível baixar o vídeo.', 'error')
  }
}

// ---------------------------------------------------------------------------
// Ações da interface
// ---------------------------------------------------------------------------

ui.url.addEventListener('input', () => {
  ui.url.closest('.url-wrap').classList.remove('invalid')
  if (ui.url.value.trim()) scheduleInfoFetch()
  else loadInfo('')
})

ui.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    startDownload()
  }
})

ui.url.addEventListener('blur', () => {
  const value = ui.url.value.trim()
  if (value && !state.info && !state.downloading) loadInfo(value)
})

ui.paste.addEventListener('click', async () => {
  const text = (await window.api.readClipboard()).trim()
  if (!text) {
    setHint('A área de transferência está vazia.', 'error')
    return
  }
  ui.url.value = text
  ui.url.focus()
  loadInfo(text)
})

function bindGroup(container, apply) {
  container.addEventListener('click', (e) => {
    const button = e.target.closest('.seg')
    if (!button || button.disabled) return
    apply(button.dataset)
    syncSelectionUI()
    persistSelection()
  })
}

bindGroup(ui.mode, (data) => {
  state.mode = data.mode
})
bindGroup(ui.videoQuality, (data) => {
  state.videoQuality = data.value
})
bindGroup(ui.audioFormat, (data) => {
  state.audioFormat = data.value
})
bindGroup(ui.audioQuality, (data) => {
  state.audioQuality = data.value
})

ui.choose.addEventListener('click', async () => {
  const res = await window.api.chooseFolder()
  if (res.ok) {
    state.folder = res.folder
    ui.folderPath.textContent = res.folder
    ui.folderPath.title = res.folder
    setHint('Pasta de destino atualizada.', 'ok')
  }
})

ui.openFolder.addEventListener('click', () => {
  window.api.openFolder(state.folder)
})

ui.cancel.addEventListener('click', () => {
  ui.cancel.disabled = true
  ui.cancel.textContent = 'Cancelando…'
  ui.progressStatus.textContent = 'Cancelando download…'
  window.api.cancelDownload()
})

ui.download.addEventListener('click', startDownload)
ui.showFile.addEventListener('click', () => window.api.showFile(state.lastFile || state.folder))

ui.again.addEventListener('click', () => {
  state.info = null
  state.lastFile = null
  ui.url.value = ''
  ui.resultPanel.classList.add('hidden')
  ui.progressPanel.classList.add('hidden')
  hidePreview()
  ui.download.disabled = true
  setHint('Cole um link para começar.')
  ui.url.focus()
})

ui.updateEngine.addEventListener('click', async () => {
  ui.updateEngine.disabled = true
  const previous = ui.updateEngine.textContent
  ui.updateEngine.textContent = 'Atualizando…'
  setHint('Baixando a versão mais recente do motor…', 'loading')
  const res = await window.api.updateEngine()
  ui.updateEngine.textContent = previous
  ui.updateEngine.disabled = false
  if (res.ok) {
    ui.engineInfo.textContent = `Motor yt-dlp ${res.engine}`
    setHint('Motor atualizado com sucesso.', 'ok')
  } else {
    setHint(`Falha ao atualizar o motor: ${res.error}`, 'error')
  }
})

// arrastar e soltar um link na janela
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
  if (!text) return
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || text
  if (!/^https?:\/\//i.test(first.trim())) return
  ui.url.value = first.trim()
  loadInfo(ui.url.value)
})

// barra de título
$('btnMin').addEventListener('click', () => window.api.minimize())
$('btnMax').addEventListener('click', () => window.api.maximize())
$('btnClose').addEventListener('click', () => window.api.close())

// ---------------------------------------------------------------------------
// Tema claro / escuro
// ---------------------------------------------------------------------------

/** Aplica o tema no documento e deixa o botão coerente com o estado atual. */
function applyTheme(theme, persist = false) {
  const value = theme === 'light' ? 'light' : 'dark'
  state.theme = value
  document.documentElement.setAttribute('data-theme', value)

  const light = value === 'light'
  ui.themeIconSun.classList.toggle('hidden', light)
  ui.themeIconMoon.classList.toggle('hidden', !light)

  const label = light ? 'Mudar para tema escuro' : 'Mudar para tema claro'
  ui.themeBtn.title = label
  ui.themeBtn.setAttribute('aria-label', label)

  if (persist) window.api.saveConfig({ theme: value })
}

ui.themeBtn.addEventListener('click', () => {
  applyTheme(state.theme === 'light' ? 'dark' : 'light', true)
})

window.api.onProgress(handleProgress)

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

async function init() {
  const info = await window.api.info()

  state.folder = info.folder
  state.mode = info.mode || 'video'
  state.videoQuality = info.videoQuality || 'best'
  state.audioFormat = info.audioFormat || 'mp3'
  state.audioQuality = info.audioQuality || '320'

  applyTheme(info.theme || window.api.initialTheme || 'dark')

  ui.folderPath.textContent = info.folder
  ui.folderPath.title = info.folder

  syncSelectionUI()

  ui.engineInfo.textContent = `Motor yt-dlp ${info.engine}`
  if (!info.ffmpeg) {
    document.querySelector('.dot').classList.add('warn')
    ui.ffmpegInfo.textContent = 'FFmpeg ausente'
    ui.ffmpegInfo.title = 'Sem FFmpeg não é possível juntar vídeo + áudio.'
  } else {
    ui.ffmpegInfo.textContent = 'FFmpeg OK'
    ui.ffmpegInfo.title = info.ffmpeg
  }

  window.api.onWindowState(({ maximized }) => {
    $('btnMax').title = maximized ? 'Restaurar' : 'Maximizar'
  })

  const clipboard = (await window.api.readClipboard()).trim()
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(clipboard)) {
    ui.url.value = clipboard
    loadInfo(clipboard)
  } else {
    ui.url.focus()
  }
}

init()
