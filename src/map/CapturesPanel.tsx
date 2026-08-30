import type { ReactElement } from 'react'
import { useRef } from 'react'
import { CaptureRecorder } from '../capture/CaptureRecorder.tsx'
import { PendingCaptureList } from '../capture/PendingCaptureList.tsx'
import type { PendingCaptureId, ProjectFile } from '../project/types.ts'
import { SidePanel } from './SidePanel.tsx'

// The right column's other tenant: rendered whenever no dialogue is selected, so the queue you
// work from on the left always has an answer on the right instead of a blank column. Shares
// SidePanel's width with DialoguePanel — a width dragged on one is what the other opens at.
export function CapturesPanel({
  project,
  armedCaptureId,
  onArm,
  currentCaptureId,
  onSelect,
  width,
  onWidthChange,
  measureAvailableWidth,
}: {
  project: ProjectFile
  armedCaptureId: PendingCaptureId | null
  onArm: (captureId: PendingCaptureId) => void
  currentCaptureId: PendingCaptureId | null
  onSelect: (captureId: PendingCaptureId) => void
  width: number | null
  onWidthChange: (width: number) => void
  measureAvailableWidth: () => number
}): ReactElement {
  const panelRef = useRef<HTMLElement>(null)

  return (
    <SidePanel
      panelRef={panelRef}
      className="captures-panel"
      ariaLabel="Captures"
      resizerLabel="Captures panel width"
      width={width}
      onWidthChange={onWidthChange}
      measureAvailableWidth={measureAvailableWidth}
    >
      <CaptureRecorder />
      <PendingCaptureList
        project={project}
        armedCaptureId={armedCaptureId}
        onArm={onArm}
        currentCaptureId={currentCaptureId}
        onSelect={onSelect}
      />
    </SidePanel>
  )
}
