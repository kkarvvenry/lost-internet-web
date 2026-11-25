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
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function clean(value: unknown, max = 120): string {
  return String(value ?? '').trim().slice(0, max)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'lost-internet-catalog' })
    }

    if (!url.pathname.startsWith('/api/catalog')) {
      return json({ error: 'not found' }, 404)
    }

    try {
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const result = await env.lost_internet_catalog.prepare(
          'SELECT id, title, artist, album, genre, format, duration, likes, created_at FROM catalog_tracks ORDER BY created_at DESC LIMIT 200'
        ).all()
        return json({ tracks: result.results ?? [] })
      }

      if (url.pathname === '/api/catalog' && request.method === 'POST') {
        const body = (await request.json()) as Record<string, unknown>
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
          Number(body.duration) || 0,
          Date.now()
        ).run()
        return json({ ok: true, id }, 201)
      }

      const likeMatch = url.pathname.match(/^\/api\/catalog\/([^/]+)\/like$/)
      if (likeMatch && request.method === 'POST') {
        await env.lost_internet_catalog.prepare(
          'UPDATE catalog_tracks SET likes = likes + 1 WHERE id = ?'
        ).bind(likeMatch[1]).run()
        return json({ ok: true })
      }

      return json({ error: 'not found' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal error'
      return json({ error: message }, 500)
    }
  },
}
