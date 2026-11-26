import { describe, expect, it, vi } from 'vitest'
import { fetchSpotifyEmbedTracks, mapSpotifyPage, mapYandexPlaylist, parseSpotifyPlaylistUrl, parseYandexPlaylistUrl } from './integrations'

describe('playlist URL parsing', () => {
  it('accepts Spotify playlist links and URIs', () => {
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toBe('37i9dQZF1DXcBWIGoYBM5M')
    expect(parseSpotifyPlaylistUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M')
  })

  it('rejects foreign Spotify URLs and malformed ids', () => {
    expect(parseSpotifyPlaylistUrl('https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/playlist/short')).toBeNull()
    expect(parseSpotifyPlaylistUrl('javascript:alert(1)')).toBeNull()
  })

  it('accepts Yandex playlist links', () => {
    expect(parseYandexPlaylistUrl('https://music.yandex.ru/users/12345/playlists/678')).toEqual({ uid: '12345', kind: '678' })
    expect(parseYandexPlaylistUrl('https://music.yandex.com/users/foo/playlists/bar')).toEqual({ uid: 'foo', kind: 'bar' })
    expect(parseYandexPlaylistUrl('https://music.yandex.ru/playlists/678')).toEqual({ uid: 'me', kind: '678' })
  })

  it('rejects foreign Yandex URLs', () => {
    expect(parseYandexPlaylistUrl('https://music.example.com/users/1/playlists/2')).toBeNull()
  })
})

describe('playlist response mapping', () => {
  it('maps a Spotify page and keeps the next cursor', () => {
    const result = mapSpotifyPage({
      next: 'https://api.spotify.com/v1/playlists/abc/tracks?offset=100',
      items: [{ track: {
        name: 'Song',
        artists: [{ name: 'Artist' }, { name: 'Guest' }],
        album: { name: 'Album' },
        duration_ms: 185000,
        preview_url: 'https://p.scdn.co/mp3-preview/xyz',
        external_urls: { spotify: 'https://open.spotify.com/track/xyz' },
      } }],
    })
    expect(result.next).toContain('offset=100')
    expect(result.tracks[0]).toEqual({
      title: 'Song',
      artist: 'Artist, Guest',
      album: 'Album',
      duration: 185,
      url: 'https://open.spotify.com/track/xyz',
      previewUrl: 'https://p.scdn.co/mp3-preview/xyz',
    })
  })

  it('maps Spotify embed tracks when the Web API is blocked', async () => {
    const nextData = JSON.stringify({
      props: { pageProps: { state: { data: { entity: { trackList: [{
        uri: 'spotify:track:4HCOHRCSQelz2GPX8iTamO',
        title: 'Song',
        subtitle: 'Artist,\u00a0Guest',
        duration: 185000,
        audioPreview: { url: 'https://p.scdn.co/mp3-preview/abc' },
      }, {}] } } } } },
    })
    vi.stubGlobal('fetch', async () => new Response(
      `<html><script id="__NEXT_DATA__" type="application/json">${nextData}</script></html>`,
      { status: 200 },
    ))
    try {
      expect(await fetchSpotifyEmbedTracks('37i9dQZF1DXcBWIGoYBM5M')).toEqual([{
        title: 'Song',
        artist: 'Artist, Guest',
        album: '',
        duration: 185,
        url: 'https://open.spotify.com/track/4HCOHRCSQelz2GPX8iTamO',
        previewUrl: 'https://p.scdn.co/mp3-preview/abc',
      }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps Yandex tracks and ignores empty entries', () => {
    const tracks = mapYandexPlaylist({
      tracks: [
        { title: 'Песня', artists: [{ name: 'Исполнитель' }], album: { title: 'Альбом' }, durationMs: 200000 },
        {},
      ],
    })
    expect(tracks).toEqual([{
      title: 'Песня',
      artist: 'Исполнитель',
      album: 'Альбом',
      duration: 200,
      url: undefined,
    }])
  })
})
