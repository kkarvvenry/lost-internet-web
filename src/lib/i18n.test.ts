import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

describe('translate', () => {
  it('keeps English text unchanged', () => {
    expect(translate('en', 'LIBRARY')).toBe('LIBRARY')
  })

  it('translates known UI strings', () => {
    expect(translate('ru', 'LIBRARY')).toBe('БИБЛИОТЕКА')
    expect(translate('ru', 'play / pause')).toBe('воспроизвести / пауза')
  })

  it('falls back to the original text for untranslated strings', () => {
    expect(translate('ru', 'raise my voice')).toBe('raise my voice')
  })
})
