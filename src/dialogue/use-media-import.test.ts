import { describe, expect, it } from 'vitest'
import { batchOutcome, importingLabel } from './use-media-import.ts'

describe('importingLabel', () => {
  it('is silent about the count for a single file', () => {
    expect(importingLabel(0, 1)).toBe('Importing…')
  })

  it('names where a multi-file batch is, one-indexed', () => {
    expect(importingLabel(0, 3)).toBe('Importing 1 of 3…')
    expect(importingLabel(2, 3)).toBe('Importing 3 of 3…')
  })
})

describe('batchOutcome', () => {
  it('is idle when nothing failed or warned', () => {
    expect(batchOutcome(3, [], [])).toEqual({ kind: 'idle' })
  })

  it('warns when every file imported but some warned', () => {
    expect(batchOutcome(2, [], ['a.gif: large file'])).toEqual({
      kind: 'warned',
      message: 'a.gif: large file',
    })
  })

  it('fails and names the count when every file in the batch failed', () => {
    expect(batchOutcome(2, ['a.pdf: unsupported', 'b.pdf: unsupported'], [])).toEqual({
      kind: 'failed',
      message: 'a.pdf: unsupported b.pdf: unsupported',
    })
  })

  it('names how many imported when only some of the batch failed', () => {
    expect(batchOutcome(3, ['c.pdf: unsupported'], [])).toEqual({
      kind: 'failed',
      message: '2 of 3 imported. c.pdf: unsupported',
    })
  })

  it('lets a failure outrank a warning — the panel has one message to give', () => {
    expect(batchOutcome(2, ['a.pdf: unsupported'], ['b.gif: large file'])).toEqual({
      kind: 'failed',
      message: '1 of 2 imported. a.pdf: unsupported',
    })
  })
})
