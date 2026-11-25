type Env = {
  lost_internet_catalog: any
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const PUBLISH_DAILY_LIMIT = 10

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function clean(value: unknown, max = 120): string {
  return String(value ?? '').trim().slice(0, max)
}

function dayNumber(): number {
  return Math.floor(Date.now() / 86400000)
}

async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')
    || 'local'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      })
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'lost-internet-catalog' })
    }

    if (!url.pathname.startsWith('/api/')) {
      return json({ error: 'not found' }, 404)
    }

    try {
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        const result = await env.lost_internet_catalog.prepare(
          'SELECT COUNT(*) AS tracks, COALESCE(SUM(likes), 0) AS likes, COUNT(DISTINCT artist) AS artists FROM catalog_tracks'
        ).first()
        return json(result ?? { tracks: 0, likes: 0, artists: 0 })
      }

      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const q = clean(url.searchParams.get('q'), 80)
        const sort = url.searchParams.get('sort') === 'likes'
          ? 'likes DESC, created_at DESC'
          : 'created_at DESC'
        const params: string[] = []
        let sql = 'SELECT id, title, artist, album, genre, format, duration, likes, created_at FROM catalog_tracks'
        if (q) {
          const escaped = q.replace(/[\\%_]/g, '\\$&')
          sql += " WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\' OR genre LIKE ? ESCAPE '\\'"
          const term = `%${escaped}%`
          params.push(term, term, term, term)
        }
        sql += ` ORDER BY ${sort} LIMIT 200`
        const statement = env.lost_internet_catalog.prepare(sql)
        const result = await (params.length ? statement.bind(...params) : statement).all()
        return json({ tracks: result.results ?? [] })
      }

      if (url.pathname === '/api/catalog' && request.method === 'POST') {
        const day = dayNumber()
        const ipHash = await hashValue(`publish:${clientIp(request)}`)
        const claim = await env.lost_internet_catalog.prepare(
          'INSERT INTO catalog_publish_hits (day, ip_hash, count, created_at) VALUES (?, ?, 1, ?) '
          + 'ON CONFLICT(day, ip_hash) DO UPDATE SET count = catalog_publish_hits.count + 1 RETURNING count'
        ).bind(day, ipHash, Date.now()).first()
        if (Number(claim?.count ?? 0) > PUBLISH_DAILY_LIMIT) {
          return json({ error: 'publish rate limit exceeded', limit: PUBLISH_DAILY_LIMIT }, 429)
        }

        const raw = await request.text()
        if (raw.length > 8192) return json({ error: 'payload too large' }, 413)
        let body: Record<string, unknown>
        try {
          body = JSON.parse(raw) as Record<string, unknown>
        } catch {
          return json({ error: 'invalid JSON' }, 400)
        }
        const title = clean(body.title, 180)
        if (!title) return json({ error: 'title is required' }, 400)

        const id = crypto.randomUUID()
        await env.lost_internet_catalog.prepare(
          'INSERT INTO catalog_tracks (id, title, artist, album, genre, format, duration, likes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
        ).bind(
          id,
          title,
          clean(body.artist, 120) || 'unknown artist',
          clean(body.album, 120),
          clean(body.genre, 80),
          clean(body.format, 16).toUpperCase(),
          Math.min(86400, Math.max(0, Number(body.duration) || 0)),
          Date.now()
        ).run()
        return json({ ok: true, id }, 201)
      }

      const likeMatch = url.pathname.match(/^\/api\/catalog\/([^/]+)\/like$/)
      if (likeMatch && request.method === 'POST') {
        const trackId = clean(likeMatch[1], 64)
        const exists = await env.lost_internet_catalog.prepare(
          'SELECT 1 FROM catalog_tracks WHERE id = ?'
        ).bind(trackId).first()
        if (!exists) return json({ error: 'track not found' }, 404)
        const ipHash = await hashValue(clientIp(request))
        const day = dayNumber()
        const hitKey = `${trackId}:${ipHash}:${day}`
        const claim = await env.lost_internet_catalog.prepare(
          'INSERT OR IGNORE INTO catalog_like_hits (hit_key, track_id, ip_hash, day, created_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(hitKey, trackId, ipHash, day, Date.now()).run()
        if (!claim.meta?.changes) return json({ ok: true, duplicate: true })

        await env.lost_internet_catalog.prepare(
          'UPDATE catalog_tracks SET likes = likes + 1 WHERE id = ?'
        ).bind(trackId).run()
        return json({ ok: true })
      }

      return json({ error: 'not found' }, 404)
    } catch (error) {
      console.error(error)
      return json({ error: 'internal error' }, 500)
    }
  },
}
