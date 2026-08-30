import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the dev server forwards API calls. Using a proxy keeps the browser on a single origin
  // (no CORS) and accepts the API's self-signed development certificate (secure: false).
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://localhost:7089'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, secure: false },
        '/health': { target: apiTarget, changeOrigin: true, secure: false },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }
})
