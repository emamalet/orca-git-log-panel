import type { DiffHunk, DiffLine, FileChange, FileDiff } from '../shared/protocol.ts'
import { api, errorMessage } from './api.ts'
import { h, icon } from './dom.ts'
import { changedRange, changeStarts, splitRows } from './diffmodel.ts'
import { shortHash, STATUS_NAMES } from './format.ts'
import { closePopups } from './menu.ts'

export type DiffMode = 'split' | 'unified'

export interface DiffOptions {
  root: string
  hash: string
  files: FileChange[]
  index: number
  mode?: DiffMode
  wholeFile?: boolean
  /** Called when the user switches layout or context, to remember it. */
  onPrefs?(mode: DiffMode, wholeFile: boolean): void
}

let closeOpen: (() => void) | null = null

/** Highlight ranges for lines paired with a counterpart: only the changed middle is emphasised. */
function wordRanges(hunks: DiffHunk[]): Map<DiffLine, [number, number]> {
  const ranges = new Map<DiffLine, [number, number]>()
  for (const hunk of hunks) {
    for (const { left, right } of splitRows(hunk)) {
      if (left?.kind !== '-' || right?.kind !== '+' || left.text.length > 2000 || right.text.length > 2000) continue
      const range = changedRange(left.text, right.text)
      if (!range) continue
      ranges.set(left, [range[0], range[1]])
      ranges.set(right, [range[0], range[2]])
    }
  }
  return ranges
}

function code(line: DiffLine | undefined, ranges: Map<DiffLine, [number, number]>): HTMLElement {
  if (!line) return h('div', { class: 'd-code d-empty' })
  const range = ranges.get(line)
  const cls = `d-code ${line.kind === '+' ? 'add' : line.kind === '-' ? 'del' : ''}`
  if (!range || range[0] === range[1]) return h('div', { class: cls }, line.text || '\u200b')
  return h(
    'div',
    { class: cls },
    line.text.slice(0, range[0]),
    h('span', { class: 'word' }, line.text.slice(range[0], range[1])),
    line.text.slice(range[1])
  )
}

const num = (value: number | undefined, kind?: string) =>
  h('div', { class: `d-num ${kind === '+' ? 'add' : kind === '-' ? 'del' : ''}` }, value === undefined ? '' : String(value))

const hunkRow = (hunk: DiffHunk) =>
  h('div', { class: 'd-hunk' }, `@@ -${hunk.oldStart} +${hunk.newStart} @@`, hunk.section ? h('span', { class: 'section' }, hunk.section) : null)

function renderLines(diff: FileDiff, mode: DiffMode): { rows: HTMLElement[]; changes: HTMLElement[] } {
  const ranges = wordRanges(diff.hunks)
  const rows: HTMLElement[] = []
  const changed: boolean[] = []
  for (const hunk of diff.hunks) {
    if (diff.hunks.length > 1 || hunk.oldStart > 1 || hunk.newStart > 1) {
      rows.push(hunkRow(hunk))
      changed.push(false)
    }
    if (mode === 'split') {
      for (const { left, right } of splitRows(hunk)) {
        const isChange = left?.kind !== ' ' || right?.kind !== ' '
        rows.push(
          h('div', { class: `d-row${isChange ? ' change' : ''}` }, num(left?.old, left?.kind), code(left, ranges), num(right?.new, right?.kind), code(right, ranges))
        )
        changed.push(isChange)
      }
    } else {
      for (const line of hunk.lines) {
        rows.push(h('div', { class: `d-row${line.kind === ' ' ? '' : ' change'}` }, num(line.old, line.kind), num(line.new, line.kind), code(line, ranges)))
        changed.push(line.kind !== ' ')
      }
    }
  }
  return { rows, changes: changeStarts(changed, Boolean).map((i) => rows[i]) }
}

/** Opens the full-window viewer on `files[index]`; Escape closes it, Alt+↑/↓ moves between files. */
export function openDiff(options: DiffOptions): void {
  closeOpen?.()
  closePopups()
  const { root, hash, files } = options
  let index = Math.max(0, Math.min(options.index, files.length - 1))
  let mode: DiffMode = options.mode ?? (innerWidth < 700 ? 'unified' : 'split')
  let wholeFile = Boolean(options.wholeFile)
  let diff: FileDiff | null = null
  let changes: HTMLElement[] = []
  let token = 0

  const title = h('div', { class: 'diff-title' })
  const counter = h('span', { class: 'muted' })
  const body = h('div', { class: 'diff-body', tabindex: '-1' })
  const button = (iconName: Parameters<typeof icon>[0], tip: string, run: () => void) =>
    h('button', { class: 'tool', title: tip, 'aria-label': tip, onclick: run }, icon(iconName))
  const prevFile = button('up', 'Previous file (Alt+↑)', () => go(index - 1))
  const nextFile = button('down', 'Next file (Alt+↓)', () => go(index + 1))
  const modeButton = h('button', { class: 'tool', onclick: () => setMode(mode === 'split' ? 'unified' : 'split') })
  const wholeButton = h('button', { class: 'tool', title: 'Show the whole file instead of the changed regions', onclick: () => setWhole(!wholeFile) }, 'Whole file')
  const view = h(
    'div',
    { class: 'diff-view', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'diff-header' },
      title,
      h('div', { class: 'spacer' }),
      h('button', { class: 'tool', title: 'Previous change (Shift+F7)', onclick: () => jump(-1) }, '↑ Change'),
      h('button', { class: 'tool', title: 'Next change (F7)', onclick: () => jump(1) }, '↓ Change'),
      h('span', { class: 'sep' }),
      prevFile,
      counter,
      nextFile,
      h('span', { class: 'sep' }),
      modeButton,
      wholeButton,
      button('close', 'Close (Esc)', () => close())
    ),
    body
  )

  function syncHeader(): void {
    const file = files[index]
    const letter = file.status[0] ?? 'M'
    title.replaceChildren(
      h('span', { class: `status-letter st-${letter}`, title: STATUS_NAMES[letter] ?? file.status }, letter),
      h('span', { class: 'path', title: file.path }, file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path),
      h('span', { class: 'mono muted' }, shortHash(hash))
    )
    counter.textContent = `${index + 1}/${files.length}`
    prevFile.disabled = index === 0
    nextFile.disabled = index === files.length - 1
    modeButton.textContent = mode === 'split' ? 'Side-by-side' : 'Unified'
    modeButton.title = mode === 'split' ? 'Switch to a unified view' : 'Switch to a side-by-side view'
    modeButton.classList.toggle('on', mode === 'split')
    wholeButton.classList.toggle('on', wholeFile)
  }

  function render(): void {
    if (!diff) return
    const note = (text: string) => h('div', { class: 'diff-note muted' }, text)
    if (diff.binary) {
      body.replaceChildren(note('Binary file: no text changes to show.'))
      changes = []
      return
    }
    if (!diff.hunks.length) {
      body.replaceChildren(note(files[index].oldPath ? 'File renamed without content changes.' : 'No content changes.'))
      changes = []
      return
    }
    const digits = String(Math.max(...diff.hunks.map((x) => Math.max(x.oldStart, x.newStart) + x.lines.length))).length
    const rendered = renderLines(diff, mode)
    changes = rendered.changes
    const lines = h('div', { class: `diff-lines ${mode}`, style: `--num-w: ${digits + 2}ch` }, ...rendered.rows)
    body.replaceChildren(...(diff.truncated ? [note('This diff is too large: only the beginning is shown.')] : []), lines)
  }

  async function load(): Promise<void> {
    const mine = ++token
    syncHeader()
    diff = null
    body.replaceChildren(h('div', { class: 'diff-note muted' }, 'Loading…'))
    try {
      const result = await api.diff(root, hash, files[index], wholeFile)
      if (mine !== token) return
      diff = result
      render()
      body.scrollTop = 0
      if (wholeFile && changes.length) jump(1, -Infinity)
    } catch (error) {
      if (mine === token) body.replaceChildren(h('div', { class: 'diff-note error' }, errorMessage(error)))
    }
  }

  function go(next: number): void {
    if (next < 0 || next >= files.length || next === index) return
    index = next
    void load()
  }

  function setMode(next: DiffMode): void {
    mode = next
    options.onPrefs?.(mode, wholeFile)
    syncHeader()
    render()
  }

  function setWhole(next: boolean): void {
    wholeFile = next
    options.onPrefs?.(mode, wholeFile)
    void load()
  }

  /** Scrolls the next or previous block of changes to just below the top of the view. */
  function jump(direction: 1 | -1, from = body.getBoundingClientRect().top + 40): void {
    if (!changes.length) return
    const top = body.getBoundingClientRect().top + 40
    const offsets = changes.map((el) => el.getBoundingClientRect().top - from)
    let i = direction > 0 ? offsets.findIndex((y) => y > 2) : offsets.findLastIndex((y) => y < -2)
    if (i < 0) i = direction > 0 ? 0 : changes.length - 1
    body.scrollTop += changes[i].getBoundingClientRect().top - top
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close()
    else if (event.altKey && event.key === 'ArrowUp') go(index - 1)
    else if (event.altKey && event.key === 'ArrowDown') go(index + 1)
    else if (event.key === 'F7') jump(event.shiftKey ? -1 : 1)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const previousFocus = document.activeElement as HTMLElement | null
  function close(): void {
    token++
    document.removeEventListener('keydown', onKey, true)
    view.remove()
    closeOpen = null
    previousFocus?.focus({ preventScroll: true })
  }

  closeOpen = close
  document.addEventListener('keydown', onKey, true)
  document.body.append(view)
  body.focus({ preventScroll: true })
  void load()
}
