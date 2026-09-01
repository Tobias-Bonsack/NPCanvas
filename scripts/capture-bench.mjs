#!/usr/bin/env node
// Measures the capture read pipeline against a real project's own media, since the only inputs
// that prove anything are frames the game actually produced. Not a CI gate: it needs a project
// folder, and the numbers are machine-specific.
//
// No dependency beyond Node's standard library, per CLAUDE.md § Dependencies — including the PNG
// reader below, which handles exactly what `capture-read-worker.ts` writes (8-bit RGBA, no interlace).

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

import {
  binarise,
  inkThreshold,
  matchGlyph,
  readTextBox,
  readTiles,
  sampleNative,
  toGlyphBits,
} from '../src/capture/glyph-matcher.ts'
import { contentBounds, detectScreenRect, detectTextRect, edgeEnergy, fitLattice } from '../src/capture/auto-calibrate.ts'
import { TILE_SIZE } from '../src/capture/capture-profile.ts'

const args = parseArgs(process.argv.slice(2))
const projectDir = args.project ?? process.env.NPCANVAS_PROJECT
if (projectDir === undefined) {
  console.error('usage: node scripts/capture-bench.mjs --project <folder> [--limit N] [--rounds N]')
  process.exit(2)
}
const rounds = Number(args.rounds ?? 7)

const document = JSON.parse(readFileSync(join(projectDir, 'data.json'), 'utf8'))
const glyphs = document.glyphs
const profiles = document.captureProfiles

const mediaDir = join(projectDir, 'media')
const files = readdirSync(mediaDir).filter((name) => name.endsWith('.png'))
const limit = args.limit === undefined ? files.length : Number(args.limit)

const loadStart = performance.now()
const corpus = []
for (const name of files.slice(0, limit)) {
  try {
    corpus.push(decodePng(readFileSync(join(mediaDir, name))))
  } catch (error) {
    console.error(`skipped ${name}: ${error.message}`)
  }
}
const loadMs = performance.now() - loadStart

console.log(`project     ${projectDir}`)
console.log(`corpus      ${corpus.length} frames, ${corpus[0].width}x${corpus[0].height}, decoded in ${loadMs.toFixed(0)} ms`)
console.log(`alphabet    ${glyphs.length} glyphs`)
console.log(`profiles    ${profiles.map((p) => `${p.name} (text ${p.textRect.width}x${p.textRect.height})`).join(', ')}`)
console.log(`node        ${process.version} on ${process.platform}`)
console.log('')

// The stored media *is* what `grabNativeFrame` now hands the reader, so the corpus feeds
// `readTextBox` directly - no sampling stage in between, exactly as in the app.

// ---------------------------------------------------------------- A. the 10 Hz read

section('A. readTextBox - the watcher tick')

for (const profile of profiles) {
  // Distinct frames every iteration: this is the cache-miss cost, what a *new* box costs.
  const cold = measure(rounds, corpus.length, () => {
    for (const frame of corpus) readTextBox(frame, profile, glyphs)
  })
  // What the same box costs on every tick after the first - the watcher's actual steady state.
  const still = corpus[Math.floor(corpus.length / 2)]
  const warm = measure(rounds, corpus.length, () => {
    for (let i = 0; i < corpus.length; i++) readTextBox(still, profile, glyphs)
  })
  row(`${profile.name} - new box (cache miss)`, cold)
  row(`${profile.name} - unchanged box (cache hit)`, warm)
}

// ---------------------------------------------------------------- B. stage breakdown

section('B. stage breakdown - profile ' + profiles[0].name)

{
  const profile = profiles[0]
  const { textRect, nativeWidth, nativeHeight } = profile
  const identity = { x: 0, y: 0, width: nativeWidth, height: nativeHeight }
  const regionWidth = Math.round(textRect.width)
  const regionHeight = Math.round(textRect.height)
  const columns = Math.floor(textRect.width / TILE_SIZE)
  const tileRows = Math.floor(textRect.height / TILE_SIZE)
  const scratchNative = new Uint8ClampedArray(nativeWidth * nativeHeight * 4)
  const scratchBits = new Uint8Array(regionWidth * regionHeight)
  const scratchGrid = { columns, rows: tileRows, cells: new Uint8Array(columns * tileRows * TILE_SIZE) }

  const natives = corpus
  const thresholds = natives.map((native) => inkThreshold(native, textRect))
  const grids = natives.map((native, i) => readTiles(binarise(native, thresholds[i], textRect), regionWidth, textRect))

  row('sampleNative - no longer on this path', measure(rounds, corpus.length, () => {
    for (const frame of corpus) sampleNative(frame, identity, nativeWidth, nativeHeight, { x: 0, y: 0 }, scratchNative)
  }))
  row('inkThreshold (Otsu over textRect)', measure(rounds, corpus.length, () => {
    for (const native of natives) inkThreshold(native, textRect)
  }))
  row('binarise (textRect)', measure(rounds, corpus.length, () => {
    for (let i = 0; i < natives.length; i++) binarise(natives[i], thresholds[i], textRect, scratchBits)
  }))
  row('binarise + readTiles', measure(rounds, corpus.length, () => {
    for (let i = 0; i < natives.length; i++) {
      readTiles(binarise(natives[i], thresholds[i], textRect, scratchBits), regionWidth, textRect, scratchGrid)
    }
  }))
  row('glyph match loop', measure(rounds, corpus.length, () => {
    for (const grid of grids) matchAll(grid)
  }))
  row('toGlyphBits alone (per non-empty tile)', measure(rounds, corpus.length, () => {
    for (const grid of grids) hashAll(grid)
  }))
}

// ---------------------------------------------------------------- D. calibration

section('D. calibration - one-off, the user waits for it')

{
  row('detectTextRect (160x144)', measure(Math.min(rounds, 5), corpus.length, () => {
    for (const frame of corpus) detectTextRect(frame)
  }))

  const profile = profiles[0]
  const wide = corpus.slice(0, 3).map((native) =>
    upscaleInto(native, profile.screenRect, { x: 0, y: 0, width: profile.frameWidth, height: profile.frameHeight }),
  )
  row(`detectScreenRect (${profile.frameWidth}x${profile.frameHeight}, ${mb(wide[0])})`, measure(3, wide.length, () => {
    for (const frame of wide) detectScreenRect(frame, profile.nativeWidth, profile.nativeHeight)
  }))
  const detected = detectScreenRect(wide[0], profile.nativeWidth, profile.nativeHeight)
  console.log(`    detected ${JSON.stringify(detected?.screenRect)} vs. profile ${JSON.stringify(profile.screenRect)}`)

  const bounds = contentBounds(wide[0], 24)
  const region = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
  row('  contentBounds (whole frame)', measure(3, wide.length, () => {
    for (const frame of wide) contentBounds(frame, 24)
  }))
  row('  edgeEnergy x + y', measure(3, wide.length, () => {
    for (const frame of wide) {
      edgeEnergy(frame, region, 'x')
      edgeEnergy(frame, region, 'y')
    }
  }))
  const energyX = edgeEnergy(wide[0], region, 'x')
  row('  fitLattice (one axis, one signal)', measure(3, 1, () => {
    fitLattice(energyX, (region.width / profile.nativeWidth) * 0.25, (region.width / profile.nativeWidth) * 1.05)
  }))

  // How the one blocking measurement scales with the player's monitor, since `measure()` in
  // `CaptureCalibration.tsx` runs it synchronously inside the click handler.
  for (const [frameWidth, frameHeight] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    const screen = fitScreenRect(frameWidth, frameHeight, profile.nativeWidth, profile.nativeHeight)
    const frame = upscaleInto(corpus[0], screen, { x: 0, y: 0, width: frameWidth, height: frameHeight })
    const found = detectScreenRect(frame, profile.nativeWidth, profile.nativeHeight)
    row(`  detectScreenRect at ${frameWidth}x${frameHeight}`, measure(3, 1, () => {
      detectScreenRect(frame, profile.nativeWidth, profile.nativeHeight)
    }))
    console.log(`      ${found === null ? 'FAILED' : `off by ${Math.abs(found.screenRect.x - screen.x)}, ${Math.abs(found.screenRect.y - screen.y)} px; size ${found.screenRect.width}x${found.screenRect.height} vs ${screen.width}x${screen.height}`}`)
  }
}

// A centred integer-multiple screen, the way an emulator window sits on a monitor.
function fitScreenRect(frameWidth, frameHeight, nativeWidth, nativeHeight) {
  const scale = Math.floor(Math.min(frameWidth / nativeWidth, frameHeight / nativeHeight)) - 1
  const width = nativeWidth * scale
  const height = nativeHeight * scale
  return { x: Math.round((frameWidth - width) / 2), y: Math.round((frameHeight - height) / 2), width, height }
}

// ---------------------------------------------------------------- E. what the corpus reads as

section('E. reading outcome over the whole corpus')

for (const profile of profiles) {
  const counts = { empty: 0, clean: 0, partial: 0 }
  let unreadableTotal = 0
  const unknownBits = new Map()
  for (const frame of corpus) {
    const reading = readTextBox(frame, profile, glyphs)
    unreadableTotal += reading.unreadable
    for (const tile of reading.unknown) unknownBits.set(tile.bits, (unknownBits.get(tile.bits) ?? 0) + 1)
    if (reading.unknown.length > 0) counts.partial++
    else if (reading.text === '') counts.empty++
    else counts.clean++
  }
  const share = (n) => `${((n / corpus.length) * 100).toFixed(1)}%`
  console.log(`  ${profile.name}`)
  console.log(`    fully read     ${counts.clean} (${share(counts.clean)})`)
  console.log(`    unnamed tiles  ${counts.partial} frames (${share(counts.partial)}), ${unreadableTotal} tiles, ${unknownBits.size} distinct bitmaps`)
  console.log(`    empty box      ${counts.empty} (${share(counts.empty)})`)
  const top = [...unknownBits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (top.length > 0) console.log(`    most seen unknown: ${top.map(([bits, n]) => `${bits} x${n}`).join(', ')}`)
}

{
  // Which profile a frame was captured under is not stored, so the honest coverage figure is the
  // better of the two readings - the profile picker is the player's, and they pick the right one.
  let clean = 0
  let unreadable = 0
  for (const frame of corpus) {
    const readings = profiles.map((profile) => readTextBox(frame, profile, glyphs))
    const best = readings.reduce((a, b) => (a.unreadable <= b.unreadable ? a : b))
    if (best.unknown.length === 0 && best.text !== '') clean++
    unreadable += best.unreadable
  }
  console.log(`  best profile per frame`)
  console.log(`    fully read     ${clean} (${((clean / corpus.length) * 100).toFixed(1)}%), ${unreadable} unnamed tiles left`)
}

// ---------------------------------------------------------------- helpers

function matchAll(grid) {
  let matched = 0
  for (let index = 0; index < grid.columns * grid.rows; index++) {
    const cell = grid.cells.subarray(index * TILE_SIZE, index * TILE_SIZE + TILE_SIZE)
    if (cell.every((row) => row === 0)) continue
    if (matchGlyph(cell, glyphs) !== null) matched++
  }
  return matched
}

function hashAll(grid) {
  let length = 0
  for (let index = 0; index < grid.columns * grid.rows; index++) {
    const cell = grid.cells.subarray(index * TILE_SIZE, index * TILE_SIZE + TILE_SIZE)
    if (cell.every((row) => row === 0)) continue
    length += toGlyphBits(cell).length
  }
  return length
}

// Nearest neighbour, the same upscale an emulator does - `detectScreenRect` fits the lattice that
// makes, so a smoothed synthetic frame would measure a signal the app was not built to read.
// Calibration is the only stage that still sees a frame this size.
function upscaleInto(native, screenRect, crop) {
  const data = new Uint8ClampedArray(crop.width * crop.height * 4)
  const scaleX = screenRect.width / native.width
  const scaleY = screenRect.height / native.height
  for (let y = 0; y < crop.height; y++) {
    const sourceY = Math.floor((crop.y + y - screenRect.y) / scaleY)
    const inRow = sourceY >= 0 && sourceY < native.height
    for (let x = 0; x < crop.width; x++) {
      const to = (y * crop.width + x) * 4
      data[to + 3] = 255
      if (!inRow) continue
      const sourceX = Math.floor((crop.x + x - screenRect.x) / scaleX)
      if (sourceX < 0 || sourceX >= native.width) continue
      const from = (sourceY * native.width + sourceX) * 4
      data[to] = native.data[from]
      data[to + 1] = native.data[from + 1]
      data[to + 2] = native.data[from + 2]
    }
  }
  return { width: crop.width, height: crop.height, data }
}

// Mirrors `growAndClamp` in `capture-session.ts` - the crop `grabFrame` hands the reader.
function growAndClamp(rect, frameWidth, frameHeight) {
  const left = Math.max(0, Math.floor(rect.x) - 1)
  const top = Math.max(0, Math.floor(rect.y) - 1)
  const right = Math.min(frameWidth, Math.ceil(rect.x + rect.width) + 1)
  const bottom = Math.min(frameHeight, Math.ceil(rect.y + rect.height) + 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function measure(passes, operations, body) {
  body()
  const perOp = []
  for (let pass = 0; pass < passes; pass++) {
    const start = performance.now()
    body()
    perOp.push(((performance.now() - start) * 1000) / operations)
  }
  perOp.sort((a, b) => a - b)
  return { median: perOp[Math.floor(perOp.length / 2)], best: perOp[0], worst: perOp[perOp.length - 1] }
}

function row(label, stats) {
  const rate = 1000 / stats.median
  const perSecond = rate >= 1000 ? `${(rate / 1000).toFixed(1)}k` : rate.toFixed(0)
  console.log(
    `  ${label.padEnd(46)}${stats.median.toFixed(1).padStart(9)} us   (${stats.best.toFixed(1)} - ${stats.worst.toFixed(1)})   ${perSecond}/s`,
  )
}

function section(title) {
  console.log(title)
}

function mb(buffer) {
  return `${(buffer.data.length / 1048576).toFixed(1)} MB`
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    out[argv[i].slice(2)] = argv[i + 1]
    i++
  }
  return out
}

function decodePng(buffer) {
  let position = 8
  let width = 0
  let height = 0
  let depth = 0
  let colourType = 0
  let interlace = 0
  const parts = []
  while (position + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(position)
    const type = buffer.toString('latin1', position + 4, position + 8)
    const start = position + 8
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start)
      height = buffer.readUInt32BE(start + 4)
      depth = buffer[start + 8]
      colourType = buffer[start + 9]
      interlace = buffer[start + 12]
    } else if (type === 'IDAT') {
      parts.push(buffer.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    position = start + length + 4
  }
  if (depth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType}, interlace ${interlace})`)
  }

  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * 4
  // Unfiltered into a plain `Uint8Array` first: PNG reconstruction is mod 256, and a
  // `Uint8ClampedArray` would clamp every overflow instead of wrapping it.
  const bytes = new Uint8Array(width * height * 4)
  let read = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[read++]
    const rowStart = y * stride
    const previous = rowStart - stride
    for (let i = 0; i < stride; i++) {
      const value = raw[read + i]
      const left = i >= 4 ? bytes[rowStart + i - 4] : 0
      const up = y > 0 ? bytes[previous + i] : 0
      const upLeft = i >= 4 && y > 0 ? bytes[previous + i - 4] : 0
      bytes[rowStart + i] =
        filter === 0 ? value
        : filter === 1 ? value + left
        : filter === 2 ? value + up
        : filter === 3 ? value + ((left + up) >> 1)
        : value + paeth(left, up, upLeft)
    }
    read += stride
  }
  return { width, height, data: new Uint8ClampedArray(bytes.buffer) }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
