import { mapSpotifyPage, mapYandexPlaylist, parseSpotifyPlaylistUrl, parseYandexPlaylistUrl, type IntegrationTrack } from './lib/integrations'
import {
  ACCOUNT_COOKIE,
  ACCOUNT_DATA_LIMIT,
  SESSION_TTL_SECONDS,
  hashPassword,
  isValidEmail,
  isValidPassword,
  randomToken,
  sanitizeAccountData,
  sha256Hex,
  verifyPassword,
  type Account,
} from './lib/account'

type Env = {
  lost_internet_catalog: any
  SPOTIFY_CLIENT_ID?: string
  SPOTIFY_CLIENT_SECRET?: string
  YANDEX_MUSIC_TOKEN?: string
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const PUBLISH_DAILY_LIMIT = 10
const INTEGRATION_DAILY_LIMIT = 20
const AUTH_DAILY_LIMIT = 15
let spotifyTokenCache: { value: string; expiresAt: number } | null = null

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      ...extra,
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

function readCookie(request: Request, name: string): string {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return ''
}

function sessionCookie(token: string, request: Request, clear = false): string {
  const secure = request.url.startsWith('https:') ? '; Secure' : ''
  if (clear) return `${ACCOUNT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
  return `${ACCOUNT_COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`
}

async function createSession(env: Env, accountId: string): Promise<string> {
  const token = randomToken()
  await env.lost_internet_catalog.prepare(
    'INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), accountId, Date.now(), Date.now() + SESSION_TTL_SECONDS * 1000).run()
  return token
}

async function accountFromRequest(request: Request, env: Env): Promise<Account | null> {
  const token = readCookie(request, ACCOUNT_COOKIE)
  if (!token) return null
  const row = await env.lost_internet_catalog.prepare(
    'SELECT a.id, a.email, a.display_name, a.created_at FROM account_sessions s '
    + 'JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(await sha256Hex(token), Date.now()).first() as {
    id: string; email: string; display_name: string; created_at: number
  } | null
  if (!row) return null
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at }
}

async function consumeAuthAttempt(request: Request, env: Env, kind: string): Promise<boolean> {
  const ipHash = await hashValue(`auth:${clientIp(request)}`)
  const claim = await env.lost_internet_catalog.prepare(
    'INSERT INTO auth_hits (day, ip_hash, kind, count, created_at) VALUES (?, ?, ?, 1, ?) '
    + 'ON CONFLICT(day, ip_hash, kind) DO UPDATE SET count = auth_hits.count + 1 RETURNING count'
  ).bind(dayNumber(), ipHash, kind, Date.now()).first()
  return Number(claim?.count ?? 0) <= AUTH_DAILY_LIMIT
}

async function enforceIntegrationLimit(request: Request, env: Env): Promise<Response | null> {
  const ipHash = await hashValue(`integrations:${clientIp(request)}`)
  const claim = await env.lost_internet_catalog.prepare(
    'INSERT INTO integration_hits (day, ip_hash, count, created_at) VALUES (?, ?, 1, ?) '
    + 'ON CONFLICT(day, ip_hash) DO UPDATE SET count = integration_hits.count + 1 RETURNING count'
  ).bind(dayNumber(), ipHash, Date.now()).first()
  if (Number(claim?.count ?? 0) > INTEGRATION_DAILY_LIMIT) {
    return json({ error: 'import rate limit exceeded', limit: INTEGRATION_DAILY_LIMIT }, 429)
  }
  return null
}

async function spotifyToken(env: Env): Promise<string> {
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 30_000) return spotifyTokenCache.value
  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) throw new Error(`spotify auth ${response.status}`)
  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('spotify token missing')
  spotifyTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return data.access_token
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

    try {
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        return json({ account: await accountFromRequest(request, env) })
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = readCookie(request, ACCOUNT_COOKIE)
        if (token) {
          await env.lost_internet_catalog.prepare(
            'DELETE FROM account_sessions WHERE token_hash = ?'
          ).bind(await sha256Hex(token)).run()
        }
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', request, true) })
      }

      if ((url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') && request.method === 'POST') {
        const isRegister = url.pathname.endsWith('/register')
        if (!await consumeAuthAttempt(request, env, isRegister ? 'register' : 'login')) {
          return json({ error: 'too many attempts, try again tomorrow' }, 429)
        }
        const raw = await request.text()
        if (raw.length > 4096) return json({ error: 'payload too large' }, 413)
        let body: Record<string, unknown>
        try {
          body = JSON.parse(raw) as Record<string, unknown>
        } catch {
          return json({ error: 'invalid JSON' }, 400)
        }
        const email = clean(body.email, 200).toLowerCase()
        const password = String(body.password ?? '')
        if (!isValidEmail(email) || !isValidPassword(password)) {
          return json({ error: 'enter a valid email and a password of at least 8 characters' }, 400)
        }
        const displayName = clean(body.displayName, 60) || email.split('@')[0].slice(0, 60)

        if (isRegister) {
          const existing = await env.lost_internet_catalog.prepare(
            'SELECT 1 FROM accounts WHERE email = ?'
          ).bind(email).first()
          if (existing) return json({ error: 'an account with this email already exists' }, 409)
          const id = crypto.randomUUID()
          const createdAt = Date.now()
          await env.lost_internet_catalog.prepare(
            'INSERT INTO accounts (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
          ).bind(id, email, await hashPassword(password), displayName, createdAt).run()
          const token = await createSession(env, id)
          return json({
            account: { id, email, displayName, createdAt },
          }, 201, { 'Set-Cookie': sessionCookie(token, request) })
        }

        const row = await env.lost_internet_catalog.prepare(
          'SELECT id, email, display_name, created_at, password_hash FROM accounts WHERE email = ?'
        ).bind(email).first() as {
          id: string; email: string; display_name: string; created_at: number; password_hash: string
        } | null
        if (!row || !await verifyPassword(password, row.password_hash)) {
          return json({ error: 'invalid email or password' }, 401)
        }
        const token = await createSession(env, row.id)
        return json({
          account: { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at },
        }, 200, { 'Set-Cookie': sessionCookie(token, request) })
      }

      if (url.pathname === '/api/user/data') {
        const account = await accountFromRequest(request, env)
        if (!account) return json({ error: 'sign in required' }, 401)
        if (request.method === 'GET') {
          const row = await env.lost_internet_catalog.prepare(
            'SELECT payload FROM account_data WHERE account_id = ?'
          ).bind(account.id).first() as { payload: string } | null
          let payload: unknown = {}
          try {
            payload = row?.payload ? JSON.parse(row.payload) : {}
          } catch {
            payload = {}
          }
          return json({ payload: sanitizeAccountData(payload) })
        }
        if (request.method === 'PUT') {
          const raw = await request.text()
          if (raw.length > ACCOUNT_DATA_LIMIT) return json({ error: 'payload too large' }, 413)
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            return json({ error: 'invalid JSON' }, 400)
          }
          const payload = sanitizeAccountData(parsed)
          await env.lost_internet_catalog.prepare(
            'INSERT INTO account_data (account_id, payload, updated_at) VALUES (?, ?, ?) '
            + 'ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
          ).bind(account.id, JSON.stringify(payload), Date.now()).run()
          return json({ ok: true, payload })
        }
      }
    } catch (error) {
      console.error(error)
      return json({ error: 'account error' }, 500)
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

      if (url.pathname === '/api/integrations/playlist' && request.method === 'POST') {
        const raw = await request.text()
        if (raw.length > 8192) return json({ error: 'payload too large' }, 413)
        let body: Record<string, unknown>
        try {
          body = JSON.parse(raw) as Record<string, unknown>
        } catch {
          return json({ error: 'invalid JSON' }, 400)
        }
        const provider = body.provider === 'spotify' ? 'spotify' : body.provider === 'yandex' ? 'yandex' : null
        if (!provider) return json({ error: 'unknown provider' }, 400)
        const link = clean(body.url, 500)
        if (!link) return json({ error: 'playlist URL is required' }, 400)

        if (provider === 'spotify') {
          if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
            return json({ error: 'spotify credentials are not configured' }, 503)
          }
          const playlistId = parseSpotifyPlaylistUrl(link)
          if (!playlistId) return json({ error: 'invalid Spotify playlist URL' }, 400)
          const limited = await enforceIntegrationLimit(request, env)
          if (limited) return limited
          let token: string
          try {
            token = await spotifyToken(env)
          } catch {
            return json({ error: 'spotify authentication failed' }, 502)
          }
          const tracks: IntegrationTrack[] = []
          let next: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(name,artists(name),album(name),duration_ms,external_urls(spotify)))`
          for (let page = 0; next && page < 5; page += 1) {
            const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
            if (!response.ok) return json({ error: 'spotify request failed', status: response.status }, 502)
            const mapped = mapSpotifyPage(await response.json())
            tracks.push(...mapped.tracks)
            next = mapped.next
          }
          return json({ provider, tracks, count: tracks.length })
        }

        if (!env.YANDEX_MUSIC_TOKEN) return json({ error: 'yandex token is not configured' }, 503)
        const parsed = parseYandexPlaylistUrl(link)
        if (!parsed) return json({ error: 'invalid Yandex playlist URL' }, 400)
        const limited = await enforceIntegrationLimit(request, env)
        if (limited) return limited
        const response = await fetch(
          `https://api.music.yandex.net/users/${encodeURIComponent(parsed.uid)}/playlists/${encodeURIComponent(parsed.kind)}`,
          { headers: { Authorization: `OAuth ${env.YANDEX_MUSIC_TOKEN}`, 'X-Yandex-Music-Client': 'YandexMusicAPI' } },
        )
        if (!response.ok) return json({ error: 'yandex request failed', status: response.status }, 502)
        const tracks = mapYandexPlaylist(await response.json())
        return json({ provider, tracks, count: tracks.length })
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
