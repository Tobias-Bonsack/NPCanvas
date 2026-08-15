// `<input type="datetime-local">` has no timezone: its value is wall-clock time, exactly what
// the user reads on the control. `Dialogue.spokenAt` is an instant (ISO 8601, UTC). Converting
// by slicing the ISO string would shift the displayed time by the UTC offset — an hour or ten,
// silently — so both directions go through local-time components instead.

/** `YYYY-MM-DDTHH:mm`, the value shape Chromium's datetime-local produces and accepts. */
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/** `''` for an unparseable instant, which is what an empty control shows. */
export function toLocalDateTimeValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}` +
    `T${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`
  )
}

/**
 * `null` while the control is mid-edit — Chromium reports `''` until every segment is filled,
 * and a half-typed date must not overwrite the stored instant.
 *
 * Seconds are dropped, because the control's default step is a minute and there is no
 * sub-minute intent to preserve.
 */
export function fromLocalDateTimeValue(value: string): string | null {
  const match = LOCAL_PATTERN.exec(value)
  if (match === null) return null
  const [, year, month, day, hours, minutes] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
  )
  // `new Date(2026, 12, …)` rolls over rather than failing, so an impossible date arrives here
  // as a valid instant. Only a genuinely unrepresentable one (year 400000) is NaN.
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
