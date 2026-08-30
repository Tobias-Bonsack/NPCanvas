import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { navigate } from '../app/route.ts'
import { selectZone } from '../app/select.ts'
import { assertNever } from '../assert-never.ts'
import { dialogueSnippet, formatSpokenAt, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { npcLabel } from '../insights/filters.ts'
import type { ProjectFile, Quest } from '../project/types.ts'
import { isTextFieldFocused } from '../text-field-focus.ts'
import type { SearchResult } from './search-index.ts'
import { searchProject } from './search-index.ts'
import './SearchPalette.css'

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  dialogue: 'Dialogue',
  npc: 'NPC',
  quest: 'Quest',
  zone: 'Zone',
}

// Mounted once from App, above the route switch, so it's never tied to the view it opened from.
export function SearchPalette({
  project,
  onOpenNpcDossier,
}: {
  project: ProjectFile
  // Sets the insights dossier's open NPC and navigates — this component can't touch that view
  // state, since it lives in App.
  onOpenNpcDossier: (key: string) => void
}): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  function openPalette(): void {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActiveIndex(0)
    setOpen(true)
  }

  function closePalette(): void {
    setOpen(false)
    restoreFocus.current?.focus()
    restoreFocus.current = null
  }

  // `/` is guarded on a text field like a canvas tool key; Ctrl/Cmd+K isn't, matching the
  // convention command palettes use so it works while typing anywhere else.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (open) return
      const isModK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
      const isSlash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey
      if (!isModK && !isSlash) return
      if (isSlash && isTextFieldFocused()) return
      event.preventDefault()
      openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // role="dialog" must move focus into itself to be keyboard-operable.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const outcome = searchProject(project, query)
  const results = outcome.results
  const active = results[activeIndex] ?? null

  function pick(result: SearchResult): void {
    closePalette()
    switch (result.kind) {
      case 'dialogue':
        navigate({
          kind: 'canvas',
          dialogueId: result.dialogue.id,
          focus: { kind: 'map', id: result.dialogue.mapId },
        })
        return
      case 'npc':
        onOpenNpcDossier(result.key)
        return
      case 'quest':
        navigate({ kind: 'quests', editQuestId: result.quest.id })
        return
      case 'zone':
        selectZone(result.zone.id)
        navigate({
          kind: 'canvas',
          dialogueId: null,
          focus: { kind: 'zone', id: result.zone.id },
        })
        return
      default:
        return assertNever(result)
    }
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        closePalette()
        return
      case 'ArrowDown':
        event.preventDefault()
        if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length)
        return
      case 'ArrowUp':
        event.preventDefault()
        if (results.length > 0) setActiveIndex((index) => (index - 1 + results.length) % results.length)
        return
      case 'Enter':
        event.preventDefault()
        if (active !== null) pick(active)
        return
      default:
        return
    }
  }

  return (
    <div
      className="search-palette__backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <input
          ref={inputRef}
          className="search-palette__input"
          type="search"
          value={query}
          placeholder="Search dialogues, NPCs, quests and zones"
          aria-label="Search dialogues, NPCs, quests and zones"
          aria-controls="search-palette-results"
          aria-activedescendant={active === null ? undefined : resultElementId(active)}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={results.length > 0}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={onInputKeyDown}
        />

        {query.trim() === '' ? (
          <p className="search-palette__empty hint-text">Start typing to search the project.</p>
        ) : results.length === 0 ? (
          <p className="search-palette__empty hint-text">Nothing matches that.</p>
        ) : (
          <ul id="search-palette-results" className="search-palette__results" role="listbox">
            {results.map((result, index) => (
              <li key={resultElementId(result)}>
                <button
                  type="button"
                  id={resultElementId(result)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className="search-palette__result"
                  data-active={index === activeIndex ? 'true' : undefined}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => pick(result)}
                >
                  <span className="search-palette__kind micro-label">{KIND_LABEL[result.kind]}</span>
                  <ResultLabel result={result} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {outcome.hiddenCount > 0 && (
          <p className="search-palette__more hint-text">…and {outcome.hiddenCount} more. Narrow the search.</p>
        )}
      </div>
    </div>
  )
}

function ResultLabel({ result }: { result: SearchResult }): ReactElement {
  switch (result.kind) {
    case 'dialogue':
      return (
        <span className="search-palette__label">
          <span className="search-palette__primary">{npcNameOf(result.dialogue.npcName)}</span>
          <span className="search-palette__secondary hint-text">
            {dialogueSnippet(result.dialogue)} · {formatSpokenAt(result.dialogue.spokenAt)}
          </span>
        </span>
      )
    case 'npc':
      return (
        <span className="search-palette__label">
          <span className="search-palette__primary">{npcLabel(result.key)}</span>
          <span className="search-palette__secondary hint-text">
            {result.lineCount} {result.lineCount === 1 ? 'line' : 'lines'}
          </span>
        </span>
      )
    case 'quest':
      return (
        <span className="search-palette__label">
          <span className="search-palette__primary">{questLabel(result.quest)}</span>
          <span className="search-palette__secondary hint-text">
            {result.quest.status === 'done' ? 'Done' : 'Open'}
          </span>
        </span>
      )
    case 'zone':
      return (
        <span className="search-palette__label">
          <span className="search-palette__primary">{zoneLabel(result.zone)}</span>
        </span>
      )
    default:
      return assertNever(result)
  }
}

function resultElementId(result: SearchResult): string {
  switch (result.kind) {
    case 'dialogue':
      return `search-result-dialogue-${result.dialogue.id}`
    case 'npc':
      return `search-result-npc-${result.key}`
    case 'quest':
      return `search-result-quest-${result.quest.id}`
    case 'zone':
      return `search-result-zone-${result.zone.id}`
    default:
      return assertNever(result)
  }
}

function npcNameOf(npcName: string): string {
  const trimmed = npcName.trim()
  return trimmed === '' ? 'Unnamed NPC' : trimmed
}

function questLabel(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}
