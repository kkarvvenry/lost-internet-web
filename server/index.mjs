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
