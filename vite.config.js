import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Do NOT let the service worker intercept map tiles. Routing tile
        // fetches through Workbox's CacheFirst handler made them subject to the
        // SW's own connect-src CSP and any stale-SW quirks, which left the map
        // grey on mobile. With no tile runtimeCaching, tiles load as ordinary
        // <img> requests (governed only by img-src https:, already allowed) and
        // render reliably. Trade-off: tiles are no longer pre-cached for full
        // offline map panning — the last-known GPS dot and cached data still work.
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
      '/media': 'http://localhost:5050',
    },
  },
})
