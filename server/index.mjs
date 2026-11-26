import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProd = process.argv.includes('--prod')
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '0.0.0.0'
const app = express()

app.disable('x-powered-by')

const catalogApi = process.env.CATALOG_API || 'https://lost-internet-web.stepanb249.workers.dev'
app.use('/api', express.raw({ type: '*/*', limit: '64kb' }))
app.use('/api', async (req, res) => {
  try {
    const headers = {}
    for (const name of ['content-type', 'accept', 'cookie', 'cf-connecting-ip', 'x-forwarded-for']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    const upstreamPath = `api${req.originalUrl.replace(/^\/api/, '')}`
    const upstream = await fetch(new URL(upstreamPath, `${catalogApi.replace(/\/$/, '')}/`), {
      method: req.method,
      headers,
      body: Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined,
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    res.status(upstream.status)
    const cookies = upstream.headers.getSetCookie?.() ?? []
    for (const cookie of cookies) {
      res.appendHeader('Set-Cookie', req.secure ? cookie : cookie.replace(/;\s*Secure/gi, ''))
    }
    for (const name of [
      'Content-Type',
      'Cache-Control',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Headers',
    ]) {
      const value = upstream.headers.get(name)
      if (value) res.setHeader(name, value)
    }
    res.send(body)
  } catch {
    res.status(502).json({ error: 'catalog offline' })
  }
})

if (isProd) {
  const dist = path.join(root, 'dist')
  app.use(express.static(dist, { index: false }))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      hmr: { clientPort: port },
    },
    appType: 'custom',
  })
  app.use(vite.middlewares)
  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next()
    try {
      let html = await fs.readFile(path.join(root, 'index.html'), 'utf8')
      html = await vite.transformIndexHtml(req.originalUrl, html)
      res.status(200).type('html').send(html)
    } catch (error) {
      vite.ssrFixStacktrace(error)
      next(error)
    }
  })
}

function lanAddresses() {
  const result = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address)
    }
  }
  return [...new Set(result)]
}

app.listen(port, host, () => {
  const mode = isProd ? 'production' : 'dev'
  console.log(`LOST INTERNET is running at http://localhost:${port} (${mode})`)
  if (host === '0.0.0.0') {
    for (const ip of lanAddresses()) {
      console.log(`LAN: http://${ip}:${port}`)
    }
  }
})
