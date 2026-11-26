import { describe, expect, it } from 'vitest'
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
})
