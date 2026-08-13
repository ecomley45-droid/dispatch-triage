import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source-map upload is opt-in: it only runs when a Sentry auth token is present
// (CI / prod builds), so local `npm run build` stays fast and works with no
// Sentry setup. When enabled it uploads maps for readable stack traces, then
// deletes the .map files from dist so they're never served to the public.
const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN

export default defineConfig({
  build: { sourcemap: sentryEnabled },
  plugins: [
    react(),
    tailwindcss(),
    sentryEnabled && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      telemetry: false,
    }),
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
