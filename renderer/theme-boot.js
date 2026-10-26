'use strict'

/**
 * Aplica o tema antes da primeira pintura para evitar "flash" de tema errado.
 * O valor inicial vem do processo principal via preload (window.api.initialTheme).
 */
;(function () {
  var theme = 'dark'
  try {
    if (window.api && window.api.initialTheme === 'light') theme = 'light'
  } catch (err) {
    /* mantém o tema escuro */
  }
  document.documentElement.setAttribute('data-theme', theme)
})()
