import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

/**
 * Injects the Content-Security-Policy meta tag. Production is strict; dev needs
 * inline scripts (React refresh preamble) and a websocket for HMR.
 */
function cspPlugin(): Plugin {
  const prod = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  const dev = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self' ws: http://localhost:*",
    "object-src 'none'"
  ].join('; ')
  let isBuild = false
  return {
    name: 'gitclient-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: isBuild ? prod : dev },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    // Only package.json "dependencies" are externalized; everything in
    // devDependencies (electron-store, chokidar — both ESM-only) is bundled.
    build: { externalizeDeps: true },
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    build: { externalizeDeps: true },
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    build: { minify: true },
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@': resolve(__dirname, 'src/renderer/src'),
        // Monaco's icon font; not imported by editor.api and hidden by the package's exports map.
        'monaco-codicon.css': resolve(__dirname, 'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css')
      }
    },
    plugins: [react(), tailwindcss(), cspPlugin()]
  }
})
