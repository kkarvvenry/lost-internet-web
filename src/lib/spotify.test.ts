import { describe, expect, it } from 'vitest'
import { bytesToUrlSafe, pkceChallenge, randomVerifier, spotifyAuthorizeUrl } from './spotify'

describe('spotify PKCE helpers', () => {
  it('generates url-safe verifiers', () => {
    const verifier = randomVerifier()
    expect(verifier.length).toBeGreaterThan(40)
    expect(verifier).not.toMatch(/[+/=]/)
    expect(bytesToUrlSafe(new Uint8Array([251, 255, 62]))).not.toMatch(/[+/=]/)
  })

  it('derives a stable S256 challenge', async () => {
    const challenge = await pkceChallenge('verifier')
    expect(challenge).toBe('iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ')
    expect(challenge).not.toMatch(/[+/=]/)
  })

  it('builds an authorize url with the registered redirect uri', () => {
    const url = new URL(spotifyAuthorizeUrl({
      clientId: 'client',
      redirectUri: 'https://example.workers.dev/api/spotify/callback',
      state: 'state123',
      challenge: 'challenge123',
    }))
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(url.searchParams.get('client_id')).toBe('client')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.workers.dev/api/spotify/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state123')
    expect(url.searchParams.get('scope')).toContain('playlist-read-private')
  })
})
