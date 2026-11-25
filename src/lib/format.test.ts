import { describe, expect, it } from 'vitest'
import { clamp, dbToGain, fmt, fmtBytes, parseName } from './format'

describe('format helpers', () => {
  it('formats milliseconds as mm:ss', () => {
    expect(fmt(0)).toBe('00:00')
    expect(fmt(-500)).toBe('00:00')
    expect(fmt(61_200)).toBe('01:01')
  })

  it('formats byte counts with units', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('clamps values', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(2, 0, 1)).toBe(1)
  })

  it('converts decibels to gain', () => {
    expect(dbToGain(0)).toBeCloseTo(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
  })

  it('parses Artist - Title file names', () => {
    expect(parseName('Artist - Title.mp3')).toEqual({ artist: 'Artist', title: 'Title' })
    expect(parseName('Artist - A - B.flac')).toEqual({ artist: 'Artist', title: 'A - B' })
    expect(parseName('lonely.wav')).toEqual({ artist: 'unknown artist', title: 'lonely' })
  })
})
