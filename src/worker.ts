type Env = {
  lost_internet_catalog: any
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

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
          sql += ' WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ?'
          const term = `%${q}%`
          params.push(term, term, term, term)
        }
        sql += ` ORDER BY ${sort} LIMIT 200`
        const statement = env.lost_internet_catalog.prepare(sql)
        const result = await (params.length ? statement.bind(...params) : statement).all()
        return json({ tracks: result.results ?? [] })
      }

      if (url.pathname === '/api/catalog' && request.method === 'POST') {
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
        const trackId = likeMatch[1]
        const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('x-forwarded-for')
          || 'local'
        const day = Math.floor(Date.now() / 86400000)
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
        const ipHash = Array.from(new Uint8Array(digest))
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join('')
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
