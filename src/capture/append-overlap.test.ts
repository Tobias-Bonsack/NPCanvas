import { describe, expect, it } from 'vitest'
import { MIN_OVERLAP, appendWithoutOverlap } from './append-overlap.ts'

describe('appendWithoutOverlap', () => {
  it('appends only the new line when the box scrolled by one', () => {
    const existing = 'HELLO THERE! WELCOME TO THE WORLD'
    const incoming = 'WELCOME TO THE WORLD OF POKéMON!'
    expect(appendWithoutOverlap(existing, incoming)).toBe(
      'HELLO THERE! WELCOME TO THE WORLD OF POKéMON!',
    )
  })

  it('appends nothing when the identical frame is captured twice', () => {
    const existing = 'MY NAME IS OAK! PEOPLE CALL ME'
    expect(appendWithoutOverlap(existing, 'MY NAME IS OAK! PEOPLE CALL ME')).toBe(existing)
  })

  it('appends nothing when the incoming text is a prefix of the existing one', () => {
    const existing = 'MY NAME IS OAK! PEOPLE CALL ME'
    expect(appendWithoutOverlap(existing, 'MY NAME IS OAK!')).toBe(existing)
  })

  it('appends nothing when the incoming text sits inside the existing one', () => {
    const existing = 'THE POKéMON PROFESSOR! THIS WORLD IS INHABITED BY CREATURES'
    expect(appendWithoutOverlap(existing, 'THIS WORLD IS')).toBe(existing)
  })

  it('takes the longest overlap, not the first one that matches', () => {
    // `THE WORLD` alone also lines up, one word earlier — a shorter join would repeat `OF`.
    const existing = 'THE WORLD OF POKéMON'
    const incoming = 'THE WORLD OF POKéMON IS WIDE'
    expect(appendWithoutOverlap(existing, incoming)).toBe('THE WORLD OF POKéMON IS WIDE')
  })

  it('joins with exactly one space when nothing overlaps', () => {
    expect(appendWithoutOverlap('HELLO THERE!', 'WELCOME TO THE WORLD')).toBe(
      'HELLO THERE! WELCOME TO THE WORLD',
    )
  })

  it('returns the incoming text with no leading space when the existing one is empty', () => {
    expect(appendWithoutOverlap('', 'WELCOME')).toBe('WELCOME')
    expect(appendWithoutOverlap('   \n ', 'WELCOME')).toBe('WELCOME')
  })

  it('returns the existing text when the incoming one is empty', () => {
    const existing = 'WELCOME TO THE WORLD'
    expect(appendWithoutOverlap(existing, '')).toBe(existing)
    expect(appendWithoutOverlap(existing, '  \n')).toBe(existing)
  })

  it('rejects a single-character overlap as coincidence', () => {
    expect(appendWithoutOverlap('IT IS A POKéMON', 'NURSE JOY WAITS')).toBe(
      'IT IS A POKéMON NURSE JOY WAITS',
    )
  })

  it('accepts a short overlap when the incoming text is shorter than the minimum', () => {
    expect('NO!'.length).toBeLessThan(MIN_OVERLAP)
    expect(appendWithoutOverlap('SAY NO', 'NO!')).toBe('SAY NO!')
  })

  it('matches across differing whitespace and appends the text as it came', () => {
    const existing = 'HELLO THERE!\nWELCOME TO THE WORLD'
    const incoming = 'WELCOME  TO\nTHE WORLD OF  POKéMON!'
    expect(appendWithoutOverlap(existing, incoming)).toBe(
      'HELLO THERE!\nWELCOME TO THE WORLD OF  POKéMON!',
    )
  })

  it('continues a word when the overlap cuts inside one', () => {
    expect(appendWithoutOverlap('A WILD RATTA', 'RATTATA APPEARED')).toBe('A WILD RATTATA APPEARED')
  })
})
