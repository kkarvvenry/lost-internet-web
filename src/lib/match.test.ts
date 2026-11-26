import { describe, expect, it } from 'vitest'
import { matchScore, normalizeMatch } from './match'

describe('metadata matching', () => {
  it('normalizes case, punctuation and diacritics', () => {
    expect(normalizeMatch('Ça va — O.K.')).toBe('cavaok')
    expect(normalizeMatch('Пёс 123!')).toBe('пес123')
  })

  it('scores exact and partial matches', () => {
    expect(matchScore({ title: 'Song', artist: 'Artist' }, { title: 'song', artist: 'artist' })).toBe(4)
    expect(matchScore({ title: 'Song (Remaster)', artist: 'Artist' }, { title: 'Song', artist: 'Artist feat. X' })).toBe(3)
    expect(matchScore({ title: 'Other', artist: 'Artist' }, { title: 'Song', artist: 'Artist' })).toBe(1)
    expect(matchScore({ title: '', artist: '' }, { title: 'Song', artist: 'Artist' })).toBe(0)
  })
})
