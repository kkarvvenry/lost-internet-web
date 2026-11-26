import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  isValidEmail,
  isValidPassword,
  randomToken,
  sanitizeAccountData,
  sanitizeSettings,
  verifyPassword,
} from './account'

describe('account helpers', () => {
  it('validates credentials', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('short')).toBe(false)
  })

  it('hashes and verifies passwords', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored).toContain(':')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
    expect(await verifyPassword('wrong password', stored)).toBe(false)
    expect(await verifyPassword('correct horse battery staple', 'broken')).toBe(false)
  })

  it('generates url-safe tokens', () => {
    const token = randomToken()
    expect(token.length).toBeGreaterThan(40)
    expect(token).not.toMatch(/[+/=]/)
  })

  it('keeps only known settings', () => {
    expect(sanitizeSettings({
      theme: 'light',
      language: 'ru',
      volume: 0.5,
      eq: { bass: 3, mid: 'bad', treble: -2 },
      malicious: true,
    })).toEqual({ theme: 'light', language: 'ru', volume: 0.5, eq: { bass: 3, treble: -2 } })
  })

  it('sanitizes cloud payloads and drops foreign links', () => {
    const data = sanitizeAccountData({
      settings: { theme: 'light', evil: 1 },
      playlists: [{ id: 'p1', name: 'Mix', tracks: [{ id: 't1', title: 'Song', artist: 'Artist', duration: 12.7 }] }],
      favorites: [{ id: 't1', title: 'Song' }],
      links: { t1: { spotify: 'https://open.spotify.com/track/abc', vk: 'https://vk.com/audio', yandex: 'https://evil.example/' } },
    })
    expect(data.settings).toEqual({ theme: 'light' })
    expect(data.playlists[0].tracks[0].duration).toBe(13)
    expect(data.favorites).toHaveLength(1)
    expect(data.links.t1).toEqual({ spotify: 'https://open.spotify.com/track/abc' })
  })
})
