# YouTube Downloader

Aplicativo desktop para Windows que baixa vídeos do YouTube a partir de um link.
Mostra o progresso em tempo real (porcentagem, velocidade, tempo restante e tempo
decorrido) e permite escolher a pasta onde o arquivo será salvo.

![Electron](https://img.shields.io/badge/Electron-45-2b2e3b) ![yt-dlp](https://img.shields.io/badge/yt--dlp-2026.10.21-ff2d55)

## Baixar

Pegue a versão mais recente na página de [Releases](../../releases/latest):

- **YouTube Downloader Setup x.y.z.exe** — instalador (recomendado; instala só para o seu usuário)
- **YouTube Downloader x.y.z.exe** — versão portátil, roda sem instalar

Requisitos: **Windows 10/11, 64 bits**. O pacote já inclui o `yt-dlp` e o
`FFmpeg`, então não é preciso instalar mais nada.

> **Aviso do Windows:** os executáveis não são assinados digitalmente. Se aparecer
> "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

## Recursos

- **Cole o link** (vídeo normal, Shorts ou `youtu.be`) e o app busca título, canal,
  duração e miniatura automaticamente.
- **Tempo de download**: cronômetro em tempo real, tempo restante estimado e
  tempo total gasto ao finalizar.
- **Escolha da pasta** com o seletor nativo do Windows (a pasta fica salva para a
  próxima vez).
- **Vídeo**: Melhor, 1080p, 720p, 480p ou 360p — sempre em MP4 (vídeo + áudio juntados).
- **Somente áudio**: MP3, WAV, M4A ou FLAC, com qualidade de 320, 256, 192 ou 128 kbps
  (WAV e FLAC são sem perda, então não usam a taxa em kbps).
- **Tema claro ou escuro**: botão no canto superior direito (sol/lua); a escolha é
  lembrada na próxima abertura. Na primeira execução acompanha o tema do Windows.
- **Cancelar** download a qualquer momento (os arquivos parciais são removidos).
- **Atualizar motor** em um clique (o YouTube muda com frequência; mantenha o
  `yt-dlp` atualizado).
- Arraste e solte um link direto na janela.

## Como usar (modo desenvolvimento)

```bash
npm install         # instala o Electron
npm run setup       # baixa o yt-dlp para bin/ (se ainda não existir)
npm start           # abre o app
```

Requisitos:

- **Node.js 18+**
- **FFmpeg** — necessário para juntar vídeo + áudio e converter o áudio.
  Em desenvolvimento o app procura nesta ordem: `bin/ffmpeg.exe` → `PATH` →
  `C:\ffmpeg\bin`. Para deixar o FFmpeg dentro do projeto, rode
  `npm run fetch-ffmpeg` (baixa o build LGPL para `bin/`).

## Gerar o aplicativo instalável (.exe)

```bash
npm run build
```

O `prebuild` baixa automaticamente o **FFmpeg LGPL** para `bin/` na primeira vez
(~170 MB) e ele passa a ser incluído no pacote. Para pular o download:

```powershell
$env:FFMPEG_SKIP=1; npm run build
```

Para atualizar o FFmpeg depois: `npm run fetch-ffmpeg -- --force`.

O resultado fica em `dist/`:

- `YouTube Downloader Setup 1.0.0.exe` — instalador (cria atalho na área de trabalho)
- `YouTube Downloader 1.0.0.exe` — versão portátil, roda sem instalar

O `electron-builder` empacota a pasta `bin/` (com `yt-dlp.exe`, `ffmpeg.exe`
e os arquivos de licença do FFmpeg) junto do app. O `ffprobe` não é incluído:
o `ffmpeg.exe` sozinho dá conta de juntar, converter e embutir metadados.

### FFmpeg e licenças

O FFmpeg é distribuído sob a **LGPL 2.1+**. O build usado é o estático LGPL do
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), e o texto da licença
e o aviso de origem vão dentro de `bin/` (`FFmpeg-LICENSE.txt` e
`FFMPEG-NOTICE.txt`), sendo copiados para o pacote final. O `yt-dlp` é domínio
público (Unlicense).

## Publicar uma nova versão

O repositório já vem com o workflow [`.github/workflows/release.yml`](.github/workflows/release.yml),
que compila no Windows, gera os dois executáveis e publica uma release no GitHub.

1. Suba a versão (isso cria o commit e a tag):

   ```bash
   npm version patch   # 1.0.0 -> 1.0.1 (ou minor/major)
   ```

2. Envie o commit e a tag:

   ```bash
   git push --follow-tags
   ```

3. O GitHub Actions roda sozinho, compila e cria a release `v1.0.1` com:
   - instalador e versão portátil;
   - `SHA256SUMS.txt` para conferência;
   - notas geradas automaticamente.

A tag **precisa** bater com a versão do `package.json` (o workflow valida isso).
Para testar o build sem publicar nada, use **Actions → Release → Run workflow**
(ele só guarda os artefatos, sem criar release).

## Estrutura

```
main.js              processo principal: janela, IPC, downloads e progresso
preload.js           ponte segura entre a interface e o Node
renderer/
  index.html         interface
  style.css          temas claro e escuro (variáveis CSS)
  theme-boot.js      aplica o tema salvo antes da primeira pintura
  app.js             lógica da tela
scripts/setup.js     baixa o yt-dlp quando necessário
scripts/fetch-ffmpeg.js  baixa o FFmpeg LGPL para o build
.github/workflows/release.yml  compila e publica a release no GitHub
bin/yt-dlp.exe       motor de download
bin/ffmpeg.exe       FFmpeg (baixado, não versionado)
build/icon.ico       ícone do aplicativo
```

## Onde ficam as configurações

`%APPDATA%\YouTube Downloader\config.json` guarda a última pasta, o tipo escolhido
(vídeo ou áudio), a qualidade do vídeo, o formato/qualidade do áudio e o tema
(`dark` ou `light`).

## Problemas comuns

| Mensagem | Solução |
| --- | --- |
| `Sign in to confirm you're not a bot` | Clique em **Atualizar motor** no rodapé do app. Se continuar, instale o [Deno](https://deno.com/) (o yt-dlp usa para resolver desafios do YouTube). |
| `FFmpeg não encontrado` | Instale o FFmpeg ou rode `npm run fetch-ffmpeg` em desenvolvimento. |
| Download para no meio | Verifique a conexão e tente novamente; o app limpa os arquivos parciais. |

## Aviso

Baixe apenas conteúdo que você tem direito de baixar (autoria própria, licenças
abertas, domínio público) e respeite os Termos de Serviço do YouTube.
