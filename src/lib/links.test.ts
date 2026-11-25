import { describe, expect, it } from 'vitest'
import { buildSearchQuery, buildSearchUrl, isProviderId, normalizeServiceUrl, sanitizeLinks } from './links'

describe('service links', () => {
  it('recognizes known providers only', () => {
    expect(isProviderId('yandex')).toBe(true)
    expect(isProviderId('spotify')).toBe(true)
    expect(isProviderId('vk')).toBe(false)
  })

  it('builds a search query from artist and title', () => {
    expect(buildSearchQuery('Slayr', 'Raise My Voice')).toBe('Slayr Raise My Voice')
    expect(buildSearchQuery('unknown artist', 'Demo')).toBe('Demo')
  })

  it('encodes search queries for every provider', () => {
    expect(buildSearchUrl('yandex', 'a b&c')).toBe('https://music.yandex.ru/search?text=a%20b%26c')
    expect(buildSearchUrl('spotify', 'a b&c')).toBe('https://open.spotify.com/search/a%20b%26c')
    expect(buildSearchUrl('youtube', 'a b&c')).toBe('https://music.youtube.com/search?q=a%20b%26c')
    expect(buildSearchUrl('bandcamp', 'a b&c')).toBe('https://bandcamp.com/search?q=a%20b%26c')
    expect(buildSearchUrl('soundcloud', 'a b&c')).toBe('https://soundcloud.com/search?q=a%20b%26c')
    expect(buildSearchUrl('musicbrainz', 'a b&c')).toContain('query=a%20b%26c')
  })

  it('accepts valid service URLs and forces https', () => {
    expect(normalizeServiceUrl('yandex', 'http://music.yandex.ru/album/1/track/2')).toBe('https://music.yandex.ru/album/1/track/2')
    expect(normalizeServiceUrl('spotify', 'https://open.spotify.com/track/abc')).toBe('https://open.spotify.com/track/abc')
    expect(normalizeServiceUrl('bandcamp', 'https://artist.bandcamp.com/track/song')).toBe('https://artist.bandcamp.com/track/song')
  })

  it('rejects empty, foreign and non-http URLs', () => {
    expect(normalizeServiceUrl('spotify', '   ')).toBeNull()
    expect(normalizeServiceUrl('spotify', 'https://evil.example/track/1')).toBeNull()
    expect(normalizeServiceUrl('spotify', 'javascript:alert(1)')).toBeNull()
    expect(normalizeServiceUrl('yandex', 'not a url')).toBeNull()
  })

  it('sanitizes imported links and drops unknown providers', () => {
    expect(sanitizeLinks({
      yandex: 'http://music.yandex.ru/album/1',
      spotify: 'https://evil.example/track/1',
      vk: 'https://vk.com/audio',
    })).toEqual({ yandex: 'https://music.yandex.ru/album/1' })
    expect(sanitizeLinks(undefined)).toBeUndefined()
  })
})
