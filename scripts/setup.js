'use strict'

/**
 * Baixa o yt-dlp para a pasta bin/ caso ainda não exista.
 * Uso: npm run setup
 */

const fs = require('node:fs')
const path = require('node:path')

const isWindows = process.platform === 'win32'
const BIN_DIR = path.join(__dirname, '..', 'bin')
const TARGET = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp')
const URL = isWindows
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

async function main() {
  if (fs.existsSync(TARGET)) {
    console.log(`✔ Motor já presente em ${TARGET}`)
    return
  }

  console.log('Baixando o motor yt-dlp…')
  fs.mkdirSync(BIN_DIR, { recursive: true })

  const res = await fetch(URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Falha no download (HTTP ${res.status})`)

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(TARGET, buffer)
  if (!isWindows) fs.chmodSync(TARGET, 0o755)

  console.log(`✔ Motor salvo em ${TARGET} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch((err) => {
  console.error('✖ Não foi possível baixar o motor:', err.message)
  process.exit(1)
})
