import type { ReactElement } from 'react'
import type { ProjectRepairs } from '../project/types.ts'
import './RepairNotice.css'

type RepairedProject = Extract<ProjectRepairs, { kind: 'repaired' }>

/**
 * A project that silently shrinks is worse than one that complains. The load dropped records
 * whose references named nothing, and this is the only moment the user can connect the loss to
 * the folder they just opened — the records themselves are already gone from every view.
 *
 * `role="status"`, not `alert`: the document opened, and nothing is broken any more.
 */
export function RepairNotice({
  repairs,
  onDismiss,
}: {
  repairs: RepairedProject
  onDismiss: () => void
}): ReactElement {
  return (
    <div className="repair-notice shell-banner" role="status">
      <div className="shell-banner__text">
        <strong className="repair-notice__title">This project opened with repairs</strong>
        <span className="repair-notice__message hint-text">
          {describeRepairs(repairs)} They pointed at records the folder no longer holds, so they
          could not be shown. The repair reaches data.json with your next change.
        </span>
      </div>
      <button
        type="button"
        className="repair-notice__dismiss shell-banner__dismiss button"
        onClick={onDismiss}
        aria-label="Dismiss this notice"
      >
        ×
      </button>
    </div>
  )
}

/** Only the non-zero kinds, so the sentence never claims "0 zones" were dropped. */
function describeRepairs(repairs: RepairedProject): string {
  const parts = [
    count(repairs.dialogues, 'dialogue', 'dialogues'),
    count(repairs.zones, 'zone', 'zones'),
    count(repairs.questDialogueIds, 'quest link', 'quest links'),
    count(repairs.relevance, 'relevance tag reference', 'relevance tag references'),
    count(repairs.dialogueReferences, 'dialogue reference', 'dialogue references'),
  ].filter((part) => part !== null)
  return `Dropped ${joinWithAnd(parts)}.`
}

function count(value: number, singular: string, plural: string): string | null {
  if (value === 0) return null
  return `${String(value)} ${value === 1 ? singular : plural}`
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
