import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite serves the SPA on 5173 and proxies /api + /media to the Express
// API on 5050. In prod, Express serves the built SPA from dist/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:5050',
      '/media': 'http://localhost:5050',
    },
  },
})
