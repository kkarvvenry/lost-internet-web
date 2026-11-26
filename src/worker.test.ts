import { describe, expect, it, vi } from 'vitest'
import worker from './worker'

function fakeEnv() {
  const state = { publishes: 0 }
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() { return statement },
        async first() {
          if (sql.includes('catalog_publish_hits')) {
            state.publishes += 1
            return { count: state.publishes }
          }
          return null
        },
        async all() { return { results: [] } },
        async run() { return { meta: { changes: 1 } } },
      }
      return statement
    },
  }
  return { env: { lost_internet_catalog: db } as any, state }
}

function publishRequest() {
  return new Request('https://example.test/api/catalog', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.7', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'test track', artist: 'test artist' }),
  })
}

describe('catalog publish rate limit', () => {
  it('allows ten publishes per day and blocks the eleventh', async () => {
    const { env } = fakeEnv()
    for (let i = 0; i < 10; i += 1) {
      const response = await worker.fetch(publishRequest(), env)
      expect(response.status).toBe(201)
    }

    const blocked = await worker.fetch(publishRequest(), env)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({
      error: 'publish rate limit exceeded',
      limit: 10,
    })
  })

  it('does not rate limit health checks', async () => {
    const { env } = fakeEnv()
    const response = await worker.fetch(new Request('https://example.test/api/health'), env)
    expect(response.status).toBe(200)
  })
})

describe('personal Spotify linking', () => {
  it('requires an account for every Spotify endpoint', async () => {
    const { env } = fakeEnv()
    for (const path of ['/api/spotify/auth', '/api/spotify/link']) {
      const response = await worker.fetch(new Request(`https://example.test${path}`), env)
      expect(response.status).toBe(401)
    }
    const disconnect = await worker.fetch(new Request('https://example.test/api/spotify/disconnect', {
      method: 'POST',
    }), env)
    expect(disconnect.status).toBe(401)
  })

  it('redirects failed Spotify callbacks to the app with an error flag', async () => {
    const { env } = fakeEnv()
    const response = await worker.fetch(new Request('https://example.test/api/spotify/callback?error=access_denied'), env)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('spotify=error')
  })

  it('keeps a long authorization code intact during token exchange', async () => {
    const cookieToken = 'spotify-code-test-session'
    const code = 'A'.repeat(415)
    let tokenBody = ''
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement },
          async first() {
            if (sql.includes('FROM spotify_oauth_states')) {
              return {
                account_id: 'spotify-code-test',
                code_verifier: 'verifier',
                redirect_uri: 'https://example.test/api/spotify/callback',
                expires_at: Date.now() + 60_000,
              }
            }
            if (sql.includes('JOIN accounts')) {
              return { id: 'spotify-code-test', email: 'code@example.test', display_name: '', created_at: 0 }
            }
            return null
          },
          async all() { return { results: [] } },
          async run() { return { meta: { changes: 1 } } },
        }
        return statement
      },
    }
    const env = { lost_internet_catalog: db, SPOTIFY_CLIENT_ID: 'test-client-id' } as any

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://accounts.spotify.com/api/token') {
        tokenBody = String(init?.body ?? '')
        return new Response(JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          scope: 'playlist-read-private',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'https://api.spotify.com/v1/me') {
        return new Response(JSON.stringify({ id: 'spotify-user', display_name: 'Spotify User' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    try {
      const response = await worker.fetch(new Request(
        `https://example.test/api/spotify/callback?code=${code}&state=codestate`,
        { headers: { Cookie: `li_session=${cookieToken}` } },
      ), env)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toContain('spotify=connected')
      expect(tokenBody).toContain(`code=${code}`)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
