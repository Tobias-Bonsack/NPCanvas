import type { ReactElement } from 'react'
import { RelevanceTagList } from '../insights/RelevanceTagList.tsx'
import type { ProjectFile } from '../project/types.ts'
import './SettingsScreen.css'

type Shortcut = { keys: readonly string[]; does: string }
type ShortcutGroup = { title: string; shortcuts: readonly Shortcut[] }

/**
 * Every shortcut the app binds, read off the actual `keydown` handlers in `Nav.tsx`,
 * `MapCanvas.tsx`/`MapScreen.tsx`, `DialoguePanel.tsx`, `SearchPalette.tsx` and `Timeline.tsx` —
 * not restated from memory. Grouped by where a hand is when it reaches for one, since that is
 * how a reader would go looking rather than by which file happens to bind it.
 */
const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], does: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], does: 'Redo' },
      { keys: ['W'], does: 'Start or stop watching the text box' },
      { keys: ['Ctrl', 'K'], does: 'Open search' },
      { keys: ['/'], does: 'Open search' },
    ],
  },
  {
    title: 'Canvas',
    shortcuts: [
      { keys: ['I'], does: 'Inspect tool — pan and select pins or zones' },
      { keys: ['P'], does: 'Place dialogue tool — click a map to log a line' },
      { keys: ['Z'], does: 'Draw zone tool' },
      { keys: ['M'], does: 'Move map tool' },
      { keys: ['F'], does: 'Fit every map in view' },
      { keys: ['0'], does: 'Zoom to 100%' },
      { keys: ['+'], does: 'Zoom in' },
      { keys: ['−'], does: 'Zoom out' },
      { keys: ['Esc'], does: 'Clear the selection' },
      { keys: ['Arrows'], does: 'Pan the canvas, or nudge the selected pin or zone' },
      { keys: ['Shift', 'Arrows'], does: 'Pan or nudge faster' },
      { keys: ['Ctrl', 'Arrows'], does: 'Resize the selected zone' },
      { keys: ['Ctrl', 'Shift', 'Arrows'], does: 'Resize the selected zone faster' },
    ],
  },
  {
    title: 'Dialogue panel',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], does: 'Capture the screen into the selected line' },
      { keys: ['Esc'], does: 'Close the panel' },
      { keys: ['Arrows'], does: 'Resize the panel, while its handle has focus' },
    ],
  },
  {
    title: 'Search',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Move through the results' },
      { keys: ['Enter'], does: 'Jump to the selected result' },
      { keys: ['Esc'], does: 'Close search' },
    ],
  },
  {
    title: 'Timeline (Insights)',
    shortcuts: [
      { keys: ['Arrows'], does: 'Move focus between bars, while one has focus' },
      { keys: ['Shift', 'Arrows'], does: 'Extend a range from the focused bar' },
      { keys: ['Enter'], does: 'Filter to the range being built' },
      { keys: ['Esc'], does: 'Cancel the range being built' },
    ],
  },
]

/**
 * The fourth screen: project-wide setup rather than a place a dialogue is authored or read. See
 * CLAUDE.md § "What this app is" for why it does not compete with the other three for priority.
 */
export function SettingsScreen({ project }: { project: ProjectFile }): ReactElement {
  return (
    <section className="settings">
      <header className="settings__bar">
        <h1 className="settings__title">Settings</h1>
      </header>

      {/* The project's own vocabulary, above the machine setup #91 adds below it — the words the
          project uses come before the rig that reads them off the screen. */}
      <RelevanceTagList relevanceTags={project.relevanceTags} dialogues={project.dialogues} />

      <section className="settings__section" aria-labelledby="settings-shortcuts-heading">
        <h2 id="settings-shortcuts-heading" className="settings__section-title">
          Keyboard shortcuts
        </h2>
        <div className="settings__shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="settings__shortcut-group">
              <h3 className="settings__shortcut-group-title">{group.title}</h3>
              <dl className="settings__shortcut-list">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.does} className="settings__shortcut-row">
                    <dt className="settings__shortcut-keys">
                      {shortcut.keys.map((key, index) => (
                        <span key={key}>
                          {index > 0 && <span aria-hidden="true"> + </span>}
                          <kbd className="settings__key">{key}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="settings__shortcut-does">{shortcut.does}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
