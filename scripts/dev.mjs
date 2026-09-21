/**
 * `npm run dev` - start the API when it is not already up, then the web dev server.
 *
 * The failure this exists to prevent: the Vite proxy forwards /api to the API, so with the API not
 * listening every call returns 502 and the login page could only say "the server ran into a
 * problem". Nothing on screen pointed at the actual cause - an API that was never started, or (the
 * case that produced this script) one started from Visual Studio under the IIS Express profile,
 * which binds 44395/49677 rather than the 7089 the proxy targets.
 *
 * Plain Node, no dependencies.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The port the web dev server listens on - the one place to change it (vite.config.ts reads the same
 * WEB_PORT). Not Vite's default 5173, which another application occupies on some machines.
 */
const WEB_PORT = Number(process.env.WEB_PORT) || 5174
const WEB_URL = `http://localhost:${WEB_PORT}`

/** How long the API is given to build, migrate and start listening. */
const READY_TIMEOUT_MS = 90_000
/** One /health probe's own budget - short, because it is asked once a second. */
const PROBE_TIMEOUT_MS = 1_500

const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

/** KEY=VALUE out of a .env file: no interpolation, `#` comments and surrounding quotes dropped. */
function readEnvFile(file) {
  const values = {}
  if (!existsSync(file)) return values
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return values
}

const fileEnv = readEnvFile(path.join(WEB_DIR, '.env.development'))

/** The address the Vite proxy forwards to - the one address that has to be listening. */
const TARGET = (
  process.env.VITE_API_PROXY_TARGET ||
  fileEnv.VITE_API_PROXY_TARGET ||
  'https://localhost:7089'
).replace(/\/+$/, '')

/** The API project to start. Overridable so a differently laid out checkout still works. */
const API_PROJECT_DIR = process.env.API_PROJECT_DIR
  ? path.resolve(process.env.API_PROJECT_DIR)
  : path.resolve(WEB_DIR, '..', 'Inventory_Shipment', 'Inventory_Shipment.API')

/**
 * Is anything answering on <target>/health?
 *
 * ANY complete HTTP response counts, whatever the status: the question is whether a server is
 * there, and a 404 or a 307 answers it just as well as a 200. TLS validation is off because the
 * API serves its self-signed development certificate - the same reason the proxy sets secure:false.
 */
function probeHealth() {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL('/health', TARGET + '/')
    } catch {
      resolve(false)
      return
    }
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      { method: 'GET', timeout: PROBE_TIMEOUT_MS, rejectUnauthorized: false },
      (response) => {
        response.resume()
        resolve(true)
      },
    )
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.end()
  })
}

/** Is WEB_PORT free? Checked before Vite starts so the failure names the fix (WEB_PORT=...). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host: '127.0.0.1' }, () => server.close(() => resolve(true)))
  })
}

/** Write output line by line with `prefix`, so a matcher watching for "VITE v" still sees it. */
function prefixTo(stream, prefix) {
  let rest = ''
  return (chunk) => {
    rest += chunk.toString()
    const lines = rest.split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) stream.write(`${prefix}${line}\n`)
  }
}

const children = []

/** Stop a child and, on Windows, everything it started - dotnet run hosts the API as a grandchild. */
function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      child.kill()
    }
  } else {
    child.kill('SIGTERM')
  }
}

let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) stopChild(child)
  // Give taskkill a moment to reap the tree before this process disappears with it.
  setTimeout(() => process.exit(code), 400)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.log(`\n[dev] ${signal} - stopping`)
    shutdown(0)
  })
}

/** Start Vite. `piped` prefixes its output; otherwise it keeps the terminal (colours, hot keys). */
async function startWeb(piped) {
  const viteBin = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    console.error(`${RED}[dev] vite is not installed - run npm install${RESET}`)
    shutdown(1)
    return
  }

  if (!(await isPortFree(WEB_PORT))) {
    console.error(`${RED}[dev] port ${WEB_PORT} is already in use - stop what is on it, or run with WEB_PORT=<free port>${RESET}`)
    shutdown(1)
    return
  }

  console.log(`[dev] starting web on ${WEB_URL}`)

  // --port first so an explicit `npm run dev -- --port N` still wins (Vite takes the last one).
  const web = spawn(process.execPath, [viteBin, '--port', String(WEB_PORT), ...process.argv.slice(2)], {
    cwd: WEB_DIR,
    stdio: piped ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, WEB_PORT: String(WEB_PORT) },
  })
  children.push(web)

  if (piped) {
    web.stdout.on('data', prefixTo(process.stdout, '[web] '))
    web.stderr.on('data', prefixTo(process.stderr, '[web] '))
  }

  web.on('exit', (code) => {
    if (shuttingDown) return
    console.log(`[dev] web exited (${code ?? 0}) - stopping the API`)
    shutdown(code ?? 0)
  })
}

async function main() {
  if (await probeHealth()) {
    console.log(`[dev] API already running on ${TARGET} (e.g. from Visual Studio) - starting web only`)
    await startWeb(false)
    return
  }

  if (!existsSync(API_PROJECT_DIR)) {
    console.error(`${RED}[dev] Nothing is listening on ${TARGET}, and the API project is not at:${RESET}`)
    console.error(`${RED}[dev]   ${API_PROJECT_DIR}${RESET}`)
    console.error(`${RED}[dev] Start the API yourself, or point API_PROJECT_DIR at its folder.${RESET}`)
    process.exit(1)
  }

  console.log(`[dev] Nothing on ${TARGET} - starting the API from ${API_PROJECT_DIR}`)
  console.log(`${DIM}[dev] (a cold start builds the solution first, so give it a moment)${RESET}`)

  const api = spawn('dotnet', ['run', '--project', API_PROJECT_DIR, '--launch-profile', 'https'], {
    cwd: API_PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  children.push(api)

  api.stdout.on('data', prefixTo(process.stdout, '[api] '))
  api.stderr.on('data', prefixTo(process.stderr, '[api] '))

  api.on('error', (error) => {
    console.error(`${RED}[dev] could not run dotnet: ${error.message}${RESET}`)
    console.error(`${RED}[dev] is the .NET SDK installed and on PATH?${RESET}`)
    shutdown(1)
  })

  /** Set once the API answers, so the exit handler tells "died at start-up" from "stopped later". */
  let healthy = false

  api.on('exit', (code) => {
    if (healthy || shuttingDown) return
    console.error(`${RED}[dev] the API exited with code ${code ?? 0} before it was ready${RESET}`)
    console.error(`${RED}[dev] read the [api] lines above${RESET}`)
    shutdown(1)
  })

  const startedAt = Date.now()
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (shuttingDown || api.exitCode !== null) return

    const waited = Math.round((Date.now() - startedAt) / 1000)
    if (await probeHealth()) {
      healthy = true
      console.log(`[dev] API is up on ${TARGET} (${waited}s) - starting web`)
      await startWeb(true)
      return
    }
    if (waited % 5 === 0) console.log(`${DIM}[dev] waiting for ${TARGET}/health ... ${waited}s${RESET}`)
  }

  console.error(`${RED}[dev] the API did not answer on ${TARGET}/health within ${READY_TIMEOUT_MS / 1000}s${RESET}`)
  console.error(`${RED}[dev] read the [api] lines above${RESET}`)
  shutdown(1)
}

main()
