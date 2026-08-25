import { describe, expect, it } from 'vitest'
import { middleAddsNothing } from './middle-frame.ts'

describe('middleAddsNothing', () => {
  it('takes back a window that is only the tail of one box and the head of the next', () => {
    expect(
      middleAddsNothing(
        'Nur im ersten Bild, im 1ten und 2ten bild',
        'im 1ten und 2ten bild, im 2ten und 3ten bild',
        'im 2ten und 3ten bild, nur im 3ten bild',
      ),
    ).toBe(true)
  })

  it('keeps a window holding one word neither neighbour shows', () => {
    expect(
      middleAddsNothing(
        'Nur im ersten Bild, im 1ten und 2ten bild',
        'im 1ten und 2ten bild, NUR HIER, im 2ten und 3ten bild',
        'im 2ten und 3ten bild, nur im 3ten bild',
      ),
    ).toBe(false)
  })

  it('ignores punctuation that only the middle box showed', () => {
    // The comma sat at the end of the middle box's first line, so the later box — which starts on
    // the word after it — never shows it. Character-exact comparison would keep the frame.
    expect(middleAddsNothing('WELCOME TO THE WORLD', 'THE WORLD, OF POKéMON', 'OF POKéMON!')).toBe(
      true,
    )
  })

  it('takes back the box before it when the window only grew', () => {
    // No box before it: the only possible cut is at zero, which asks whether the whole of it is the
    // beginning of the next one. A text box filling up rather than scrolling.
    expect(middleAddsNothing('', 'HELLO THERE!', 'HELLO THERE! WELCOME')).toBe(true)
  })

  it('keeps the box before it when the window scrolled instead of growing', () => {
    expect(middleAddsNothing('', 'HELLO THERE! WELCOME', 'WELCOME TO THE WORLD')).toBe(false)
  })

  it('takes back a window the box before it already held whole', () => {
    expect(middleAddsNothing('HELLO THERE! WELCOME', 'THERE! WELCOME', 'SOMETHING ELSE')).toBe(true)
  })

  it('does not join two boxes that merely share a word', () => {
    expect(middleAddsNothing('I SAW A POKéMON', 'A POKéMON RAN PAST ME', 'ME AND MY RIVAL')).toBe(
      false,
    )
  })
})
