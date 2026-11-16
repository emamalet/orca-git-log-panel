import type { CommitDetails, CommitRow, FileChange } from '../shared/protocol.ts'
import { h, icon } from './dom.ts'
import { buildFileTree, type DirNode } from './filetree.ts'
import { fullDate, shortHash, STATUS_NAMES } from './format.ts'

const INDENT = 16
/** Folders the user folded, by path; kept while moving between commits. */
const foldedDirs = new Set<string>()

export interface DetailsHost {
  select(hash: string): void
  /** Shows the changes of `d.files[index]`. */
  openDiff(index: number): void
}

export function renderPlaceholder(container: HTMLElement, text: string): void {
  container.replaceChildren(h('div', { class: 'section muted' }, text))
}

/** The changed files as a foldable folder tree; double-click (or Enter) opens `files[index]`'s diff. */
function filesSection(files: FileChange[], note: string | null, openDiff: (index: number) => void): HTMLElement {
  const fileRow = (index: number, depth: number) => {
    const f = files[index]
    const letter = f.status[0] ?? 'M'
    return h(
      'div',
      {
        class: `file openable st-${letter}`,
        style: `padding-left:${depth * INDENT + 18}px`,
        tabindex: '0',
        title: `${STATUS_NAMES[letter] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}\nDouble-click to show the changes`,
        ondblclick: () => openDiff(index),
        onkeydown: (event: KeyboardEvent) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          openDiff(index)
        }
      },
      icon('file'),
      h('span', { class: 'name' }, f.path.slice(f.path.lastIndexOf('/') + 1)),
      h('span', { class: 'status-letter' }, letter)
    )
  }
  const folders: { path: string; row: HTMLElement; children: HTMLElement }[] = []
  const setFolded = (folder: (typeof folders)[number], folded: boolean) => {
    if (folded) foldedDirs.add(folder.path)
    else foldedDirs.delete(folder.path)
    folder.row.classList.toggle('folded', folded)
    folder.row.setAttribute('aria-expanded', String(!folded))
    folder.children.hidden = folded
  }
  const renderDir = (dir: DirNode, depth: number): HTMLElement[] => [
    ...dir.dirs.map((sub) => {
      const children = h('div', { class: 'dir-children' }, ...renderDir(sub, depth + 1))
      const row = h(
        'div',
        { class: 'file folder', style: `padding-left:${depth * INDENT}px`, tabindex: '0', title: sub.path },
        icon('chevronDown', 'twisty'),
        icon('folder'),
        h('span', { class: 'name' }, sub.name),
        h('span', { class: 'count' }, `${sub.count} file${sub.count === 1 ? '' : 's'}`)
      )
      const folder = { path: sub.path, row, children }
      folders.push(folder)
      const toggle = () => setFolded(folder, !foldedDirs.has(sub.path))
      row.addEventListener('click', toggle)
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') toggle()
        else if (event.key === 'ArrowLeft') setFolded(folder, true)
        else if (event.key === 'ArrowRight') setFolded(folder, false)
        else return
        event.preventDefault()
      })
      setFolded(folder, foldedDirs.has(sub.path))
      return h('div', null, row, children)
    }),
    ...dir.files.map((index) => fileRow(index, depth))
  ]
  const rows = renderDir(buildFileTree(files.map((f) => f.path)), 0)
  const foldAll = (folded: boolean) => folders.forEach((folder) => setFolded(folder, folded))
  const treeTools = folders.length
    ? h(
        'span',
        { class: 'files-tools' },
        h('button', { class: 'tool', title: 'Expand all', 'aria-label': 'Expand all', onclick: () => foldAll(false) }, icon('expandAll')),
        h('button', { class: 'tool', title: 'Collapse all', 'aria-label': 'Collapse all', onclick: () => foldAll(true) }, icon('collapseAll'))
      )
    : null
  return h(
    'div',
    { class: 'section' },
    h('div', { class: 'files-title' }, `${files.length} file${files.length === 1 ? '' : 's'} changed`, note ? h('span', { class: 'muted' }, note) : null, treeTools),
    ...(rows.length ? rows : [h('div', { class: 'muted' }, 'No changes')])
  )
}

/** Several commits: the files they changed together, then the commits. `files` is null while loading. */
export function renderMany(
  container: HTMLElement,
  commits: CommitRow[],
  files: FileChange[] | string | null,
  host: Pick<DetailsHost, 'select'> & { openDiff(files: FileChange[], index: number): void }
): void {
  container.replaceChildren(
    Array.isArray(files)
      ? filesSection(files, '(in the selected commits)', (index) => host.openDiff(files, index))
      : h('div', { class: 'section muted' }, files ?? 'Loading the changed files…'),
    h(
      'div',
      { class: 'section' },
      h('div', { class: 'subject' }, `${commits.length} commits selected`),
      ...commits.slice(0, 50).map((c) =>
        h(
          'div',
          { class: 'file openable', title: `${c.hash}\nClick to select only this commit`, onclick: () => host.select(c.hash) },
          h('span', { class: 'mono muted' }, shortHash(c.hash)),
          h('span', { class: 'name' }, c.subject)
        )
      ),
      commits.length > 50 ? h('div', { class: 'muted' }, `… and ${commits.length - 50} more`) : null
    )
  )
}

export function renderDetails(container: HTMLElement, d: CommitDetails, host: DetailsHost): void {
  const [subject, ...rest] = d.message.split('\n')
  const body = rest.join('\n').replace(/^\s*\n/, '')
  const parents = d.parents.map((p, i) =>
    h('span', null, i ? ', ' : '', h('a', { class: 'hash-link mono', title: p, onclick: () => host.select(p) }, shortHash(p)))
  )
  container.replaceChildren(
    filesSection(d.files, d.parents.length > 1 ? '(vs. first parent)' : null, (index) => host.openDiff(index)),

    h(
      'div',
      { class: 'section' },
      h('div', { class: 'subject' }, subject),
      body ? h('div', { class: 'body' }, body) : null,
      h(
        'div',
        { class: 'meta' },
        h('div', null, h('span', { class: 'mono' }, shortHash(d.hash)), ' ', h('span', { class: 'muted' }, 'by'), ' ', h('strong', null, d.author), ' ', h('span', { class: 'muted' }, `<${d.email}>`)),
        h('div', { class: 'muted' }, `on ${fullDate(d.authorTime)}`),
        d.committer !== d.author || d.commitTime !== d.authorTime
          ? h('div', { class: 'muted' }, `committed by ${d.committer} on ${fullDate(d.commitTime)}`)
          : null,
        parents.length ? h('div', null, h('span', { class: 'muted' }, parents.length > 1 ? 'Parents: ' : 'Parent: '), ...parents) : null,
        h('div', { class: 'mono muted', style: 'user-select:text' }, d.hash)
      ),
      h(
        'div',
        { class: 'branches-line' },
        d.branches.length
          ? [h('span', { class: 'muted' }, `In ${d.branches.length}${d.branches.length >= 50 ? '+' : ''} branch${d.branches.length === 1 ? '' : 'es'}: `), d.branches.join(', ')].reduce<HTMLElement>(
              (el, part) => (el.append(part), el),
              h('span', null)
            )
          : h('span', { class: 'muted' }, 'Not in any branch')
      )
    )
  )
}
