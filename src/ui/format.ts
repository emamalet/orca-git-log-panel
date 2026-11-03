import type { BranchRef, CommitRow } from '../shared/protocol.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** IntelliJ's log dates: "Moments ago", "5 minutes ago", "Today 14:02", "Yesterday 09:12", then the date. */
export function relativeDate(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000)
  const diff = Math.max(0, now - date.getTime())
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'Moments ago'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  if (minutes < 120) return '1 hour ago'
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (date >= today) return `Today ${hhmm(date)}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date >= yesterday) return `Yesterday ${hhmm(date)}`
  return `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })}, ${hhmm(date)}`
}

export function fullDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export interface RefLabel {
  kind: 'head' | 'local' | 'remote' | 'tag'
  text: string
  /** The checked-out branch. */
  current?: boolean
  /** Ref names this label stands for, for "Checkout" and filters. */
  refs: string[]
}

/**
 * Turns a commit's full ref names into IntelliJ-style labels: a local branch and its remote
 * counterparts on the same commit merge into "origin & main".
 */
export function refLabels(refs: string[], currentBranch: string | null): RefLabel[] {
  const locals: string[] = []
  const remotes: string[] = []
  const tags: string[] = []
  let detached = false
  for (const ref of refs) {
    if (ref === 'HEAD') detached = true
    else if (ref.startsWith('refs/heads/')) locals.push(ref.slice(11))
    else if (ref.startsWith('refs/remotes/')) remotes.push(ref.slice(13))
    else if (ref.startsWith('refs/tags/')) tags.push(ref.slice(10))
  }
  const labels: RefLabel[] = []
  if (detached) labels.push({ kind: 'head', text: 'HEAD', refs: ['HEAD'] })
  const usedRemotes = new Set<string>()
  const sortedLocals = locals.sort((a, b) => Number(b === currentBranch) - Number(a === currentBranch) || a.localeCompare(b))
  for (const name of sortedLocals) {
    const matching = remotes.filter((r) => r.slice(r.indexOf('/') + 1) === name)
    matching.forEach((r) => usedRemotes.add(r))
    const prefix = matching.map((r) => r.slice(0, r.indexOf('/'))).join(' & ')
    labels.push({
      kind: 'local',
      text: prefix ? `${prefix} & ${name}` : name,
      current: name === currentBranch,
      refs: [name, ...matching]
    })
  }
  for (const name of remotes.sort()) if (!usedRemotes.has(name)) labels.push({ kind: 'remote', text: name, refs: [name] })
  for (const name of tags.sort()) labels.push({ kind: 'tag', text: name, refs: [name] })
  return labels
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

/** Commits reachable from `head` among the loaded rows (the rest are greyed out like IntelliJ). */
export function reachableFrom(head: string | null, rows: CommitRow[]): Set<string> {
  const reachable = new Set<string>()
  if (!head) return reachable
  const byHash = new Map(rows.map((row) => [row.hash, row]))
  const stack = [head]
  while (stack.length) {
    const hash = stack.pop()!
    if (reachable.has(hash)) continue
    const row = byHash.get(hash)
    if (!row) continue
    reachable.add(hash)
    stack.push(...row.parents)
  }
  return reachable
}

/** Remote branches grouped by remote name, for the branches tree. */
export function groupRemotes(remotes: BranchRef[]): Map<string, BranchRef[]> {
  const groups = new Map<string, BranchRef[]>()
  for (const ref of remotes) {
    const remote = ref.name.slice(0, ref.name.indexOf('/')) || ref.name
    groups.set(remote, [...(groups.get(remote) ?? []), ref])
  }
  return groups
}

export const STATUS_NAMES: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Unmerged'
}
