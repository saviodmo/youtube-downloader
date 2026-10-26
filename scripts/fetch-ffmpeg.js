'use strict'

/**
 * Baixa o FFmpeg (build LGPL, estático, win64) para bin/ para ser empacotado
 * junto do aplicativo.
 *
 * Só o ffmpeg.exe é incluído: o yt-dlp usa o próprio FFmpeg para juntar
 * vídeo + áudio, converter o áudio e embutir metadados. O ffprobe não é
 * necessário para nenhuma operação do app (e pesaria mais 130 MB).
 *
 * Uso:
 *   npm run fetch-ffmpeg              # baixa apenas se ainda não existir
 *   npm run fetch-ffmpeg -- --force   # baixa de novo
 *
 * Variáveis de ambiente:
 *   FFMPEG_URL     URL alternativa do .zip (precisa conter bin/ffmpeg.exe)
 *   FFMPEG_SKIP=1  não faz nada (útil para builds offline)
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const BIN_DIR = path.join(ROOT, 'bin')
const DEFAULT_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip'
const LICENSE_FALLBACK_URL =
  'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.LGPLv2.1'
const REQUIRED = ['ffmpeg.exe']
const force = process.argv.includes('--force')

/** Procura a pasta que contém um arquivo (busca em profundidade limitada). */
function findDirWith(root, fileName, depth = 0) {
  if (depth > 5) return null
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === fileName)) {
    return root
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findDirWith(path.join(root, entry.name), fileName, depth + 1)
    if (found) return found
  }
  return null
}

/** Procura um arquivo pelo nome, com prioridade para os nomes informados. */
function findNamedFile(root, names, depth = 0) {
  if (depth > 5) return null
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const name of names) {
    const hit = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === name)
    if (hit) return path.join(root, hit.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findNamedFile(path.join(root, entry.name), names, depth + 1)
    if (found) return found
  }
  return null
}

async function download(url, target) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`falha no download (HTTP ${res.status})`)

  const total = Number(res.headers.get('content-length') || 0)
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)
  let done = 0
  let lastLog = 0

  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    done += chunk.length
    const now = Date.now()
    if (now - lastLog < 500) return
    lastLog = now
    const pct = total ? ` (${Math.round((done / total) * 100)}%)` : ''
    process.stdout.write(`\r  ${mb(done)}${total ? ` / ${mb(total)}` : ''} MB${pct}   `)
  })

  await pipeline(body, fs.createWriteStream(target))
  process.stdout.write('\n')
}

function extract(zip, out) {
  try {
    execFileSync('tar', ['-xf', zip, '-C', out], { stdio: 'pipe' })
    return
  } catch {
    /* Windows sem tar: usa o PowerShell */
  }

  const quote = (value) => `'${value.replace(/'/g, "''")}'`
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(out)} -Force`,
    ],
    { stdio: 'pipe' }
  )
}

async function saveLicense(sourceDir, url) {
  const found = findNamedFile(sourceDir, [
    'license.txt',
    'license',
    'copying.lgplv2.1',
    'copying.lgplv3',
    'copying.txt',
  ])

  let licenseText = null
  if (found) {
    licenseText = fs.readFileSync(found)
    console.log(`Licença encontrada no pacote: ${path.basename(found)}`)
  } else {
    console.log('Licença não veio no pacote; baixando o texto da LGPL 2.1…')
    const res = await fetch(LICENSE_FALLBACK_URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`falha ao baixar a licença (HTTP ${res.status})`)
    licenseText = Buffer.from(await res.arrayBuffer())
  }
  fs.writeFileSync(path.join(BIN_DIR, 'FFmpeg-LICENSE.txt'), licenseText)

  const notice = [
    'FFmpeg — build LGPL (win64)',
    `Origem: ${url}`,
    `Obtido em: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'O FFmpeg é software livre licenciado sob a GNU Lesser General Public',
    'License, versão 2.1 ou posterior. O texto completo está em',
    'FFmpeg-LICENSE.txt, nesta mesma pasta.',
    '',
    'Código-fonte do FFmpeg: https://ffmpeg.org/download.html',
    'Builds utilizados: https://github.com/BtbN/FFmpeg-Builds',
    '',
    'Apenas o ffmpeg.exe é incluído (o ffprobe não é usado pelo aplicativo).',
    '',
    'Este aplicativo executa o FFmpeg como programa separado (processo externo).',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(BIN_DIR, 'FFMPEG-NOTICE.txt'), notice, 'utf8')
}

async function main() {
  if (process.env.FFMPEG_SKIP === '1') {
    console.log('FFMPEG_SKIP=1 — pulando o download do FFmpeg.')
    return
  }

  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(BIN_DIR, name)))
  if (!missing.length && !force) {
    console.log('FFmpeg já está em bin/ — nada a fazer (use --force para atualizar).')
    return
  }

  const url = process.env.FFMPEG_URL || DEFAULT_URL
  fs.mkdirSync(BIN_DIR, { recursive: true })

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-ffmpeg-'))
  const zipPath = path.join(tempDir, 'ffmpeg.zip')
  const outDir = path.join(tempDir, 'out')

  try {
    console.log('Baixando FFmpeg (build LGPL):')
    console.log(`  ${url}`)
    await download(url, zipPath)

    fs.mkdirSync(outDir, { recursive: true })
    console.log('Extraindo…')
    extract(zipPath, outDir)

    const sourceDir = findDirWith(outDir, 'ffmpeg.exe')
    if (!sourceDir) throw new Error('ffmpeg.exe não foi encontrado dentro do .zip')

    for (const name of REQUIRED) {
      const from = path.join(sourceDir, name)
      if (!fs.existsSync(from)) {
        console.warn(`Aviso: ${name} não veio no pacote.`)
        continue
      }
      fs.copyFileSync(from, path.join(BIN_DIR, name))
      const size = (fs.statSync(from).size / 1024 / 1024).toFixed(1)
      console.log(`  bin/${name} (${size} MB)`)
    }

    await saveLicense(sourceDir, url)
    console.log('Pronto! O FFmpeg será incluído no próximo build.')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('Não foi possível preparar o FFmpeg:', err.message)
  process.exit(1)
})
