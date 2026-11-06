import type { DiffHunk, DiffLine } from '../shared/protocol.ts'

export interface SplitRow {
  left?: DiffLine
  right?: DiffLine
}

/** Side-by-side rows: context on both sides, each run of deletions paired with the additions after it. */
export function splitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind === ' ') {
      rows.push({ left: lines[i], right: lines[i] })
      i++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (i < lines.length && lines[i].kind === '-') removed.push(lines[i++])
    while (i < lines.length && lines[i].kind === '+') added.push(lines[i++])
    for (let k = 0; k < Math.max(removed.length, added.length); k++) rows.push({ left: removed[k], right: added[k] })
  }
  return rows
}

/** The changed middle of two versions of a line, as [start, oldEnd, newEnd]; null when nothing is shared. */
export function changedRange(before: string, after: string): [number, number, number] | null {
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before[start] === after[start]) start++
  let end = 0
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  if (start === 0 && end === 0) return null
  return [start, before.length - end, after.length - end]
}

/** Indexes (in rows) where a block of changes starts, for next/previous change navigation. */
export function changeStarts<T>(rows: T[], changed: (row: T) => boolean): number[] {
  const starts: number[] = []
  rows.forEach((row, i) => {
    if (changed(row) && (i === 0 || !changed(rows[i - 1]))) starts.push(i)
  })
  return starts
}
