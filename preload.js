'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Tema salvo, injetado pelo processo principal ao abrir a janela.
const themeArg = process.argv.find((arg) => arg.startsWith('--app-theme='))
const initialTheme = themeArg ? themeArg.slice('--app-theme='.length) : 'dark'

contextBridge.exposeInMainWorld('api', {
  initialTheme,
  info: () => ipcRenderer.invoke('app:info'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),

  videoInfo: (url) => ipcRenderer.invoke('video:info', url),
  startDownload: (payload) => ipcRenderer.invoke('download:start', payload),
  cancelDownload: () => ipcRenderer.invoke('download:cancel'),

  onProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('download:progress', listener)
    return () => ipcRenderer.removeListener('download:progress', listener)
  },

  openFolder: (folder) => ipcRenderer.invoke('shell:openFolder', folder),
  showFile: (filePath) => ipcRenderer.invoke('shell:showFile', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  updateEngine: () => ipcRenderer.invoke('engine:update'),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onWindowState: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('window:state', listener)
    return () => ipcRenderer.removeListener('window:state', listener)
  },
})
