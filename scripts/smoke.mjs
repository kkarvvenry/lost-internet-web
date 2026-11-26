const base = (process.env.SMOKE_URL || 'https://lost-internet-web.stepanb249.workers.dev').replace(/\/$/, '')
const checks = []

async function check(name, fn) {
  try {
    const detail = await fn()
    checks.push({ name, ok: true, detail })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

await check('index.html', async () => {
  const response = await fetch(`${base}/`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = await response.text()
  if (!html.includes('lost-internet-theme')) throw new Error('theme bootstrap missing')
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1])
  if (assets.length < 2) throw new Error(`only ${assets.length} asset references`)
  for (const asset of assets) {
    const assetResponse = await fetch(`${base}${asset}`, { cache: 'no-store' })
    if (!assetResponse.ok) throw new Error(`${asset}: HTTP ${assetResponse.status}`)
  }
  return `${assets.length} assets OK`
})

await check('service worker', async () => {
  const response = await fetch(`${base}/sw.js`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const source = await response.text()
  const match = source.match(/lost-internet-v\d+/)
  if (!match) throw new Error('cache version missing')
  return match[0]
})

await check('manifest', async () => {
  const response = await fetch(`${base}/manifest.webmanifest`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return 'OK'
})

await check('/api/health', async () => {
  const data = await getJson('/api/health')
  if (data.ok !== true) throw new Error('health flag missing')
  return data.service || 'OK'
})

await check('/api/stats', async () => {
  const data = await getJson('/api/stats')
  for (const key of ['tracks', 'likes', 'artists']) {
    if (!Number.isFinite(Number(data[key]))) throw new Error(`${key} missing`)
  }
  return `tracks=${data.tracks} likes=${data.likes}`
})

await check('/api/catalog', async () => {
  const data = await getJson('/api/catalog')
  if (!Array.isArray(data.tracks)) throw new Error('tracks is not an array')
  return `${data.tracks.length} entries`
})

await check('unknown like returns 404', async () => {
  const response = await fetch(`${base}/api/catalog/__smoke_missing__/like`, { method: 'POST' })
  if (response.status !== 404) throw new Error(`HTTP ${response.status}`)
  return '404'
})

for (const result of checks) {
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.name}: ${result.detail}`)
}

const failed = checks.filter(result => !result.ok).length
if (failed) {
  console.error(`Smoke failed: ${failed}/${checks.length}`)
  process.exit(1)
}
console.log(`Smoke passed: ${checks.length}/${checks.length}`)
