import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the dev server forwards API calls. Using a proxy keeps the browser on a single origin
  // (no CORS) and accepts the API's self-signed development certificate (secure: false).
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://localhost:7089'
  // The dev server's port. 5173 (Vite's default) is taken by another application on some machines,
  // so this project uses 5174. WEB_PORT (env or .env file) overrides it; scripts/dev.mjs passes it too.
  const webPort = Number(env.WEB_PORT) || 5174

  /**
   * What the browser gets when the API is not listening.
   *
   * Without this the proxy answers a bare 502 with no body, so the client falls through to its
   * generic 5xx text and the login page says "the server ran into a problem" - true, but it sends
   * the reader looking for a bug that is not there. The real cause is almost always an API that was
   * never started, or one started under the IIS Express profile (44395) rather than the https one
   * this target names. So: say that, in the terminal and in the response.
   */
  const onProxyError: ProxyOptions['configure'] = (proxy) => {
    proxy.on('error', (_error, _request, response) => {
      console.error(
        `\x1b[31m[proxy] API not reachable at ${apiTarget} - start Inventory_Shipment.API (npm run dev starts it)\x1b[0m`,
      )

      // `response` is a ServerResponse for a request, but a Socket when the failure was an upgrade
      // (websocket) attempt - only the former can be answered, and only before headers are sent.
      if (!('writeHead' in response) || response.headersSent || response.writableEnded) return

      response.writeHead(503, { 'Content-Type': 'application/problem+json' })
      response.end(
        JSON.stringify({
          type: 'about:blank',
          title: 'API not reachable',
          status: 503,
          code: 'API_UNREACHABLE',
          detail: `Nothing is listening on ${apiTarget}. Start Inventory_Shipment.API (npm run dev starts it automatically, or press F5 in Visual Studio) and try again.`,
        }),
      )
    })
  }

  const proxyEntry: ProxyOptions = { target: apiTarget, changeOrigin: true, secure: false, configure: onProxyError }

  return {
    plugins: [react()],
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': proxyEntry,
        '/health': proxyEntry,
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }
})
