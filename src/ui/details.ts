import type { CommitDetails, CommitRow } from '../shared/protocol.ts'
import { h, icon } from './dom.ts'
import { fullDate, shortHash, STATUS_NAMES } from './format.ts'

export interface DetailsHost {
  select(hash: string): void
  /** Shows the changes of `d.files[index]`. */
  openDiff(index: number): void
}

export function renderPlaceholder(container: HTMLElement, text: string): void {
  container.replaceChildren(h('div', { class: 'section muted' }, text))
}

export function renderMany(container: HTMLElement, commits: CommitRow[]): void {
  container.replaceChildren(
    h(
      'div',
      { class: 'section' },
      h('div', { class: 'subject' }, `${commits.length} commits selected`),
      ...commits.slice(0, 50).map((c) => h('div', { class: 'file' }, h('span', { class: 'mono muted' }, shortHash(c.hash)), h('span', { class: 'name' }, c.subject))),
      commits.length > 50 ? h('div', { class: 'muted' }, `… and ${commits.length - 50} more`) : null
    )
  )
}

export function renderDetails(container: HTMLElement, d: CommitDetails, host: DetailsHost): void {
  const [subject, ...rest] = d.message.split('\n')
  const body = rest.join('\n').replace(/^\s*\n/, '')
  const files = d.files.map((f, index) => {
    const slash = f.path.lastIndexOf('/')
    const name = f.path.slice(slash + 1)
    const dir = slash >= 0 ? f.path.slice(0, slash) : ''
    const letter = f.status[0] ?? 'M'
    return h(
      'div',
      {
        class: `file openable st-${letter}`,
        tabindex: '0',
        title: `${STATUS_NAMES[letter] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}\nDouble-click to show the changes`,
        ondblclick: () => host.openDiff(index),
        onkeydown: (event: KeyboardEvent) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          host.openDiff(index)
        }
      },
      h('span', { class: 'status-letter' }, letter),
      icon('file'),
      h('span', { class: 'name' }, name),
      dir ? h('span', { class: 'dir' }, dir) : null
    )
  })
  const parents = d.parents.map((p, i) =>
    h('span', null, i ? ', ' : '', h('a', { class: 'hash-link mono', title: p, onclick: () => host.select(p) }, shortHash(p)))
  )
  container.replaceChildren(
    h(
      'div',
      { class: 'section' },
      h('div', { class: 'files-title' }, `${d.files.length} file${d.files.length === 1 ? '' : 's'} changed`, d.parents.length > 1 ? h('span', { class: 'muted' }, '(vs. first parent)') : null),
      ...(files.length ? files : [h('div', { class: 'muted' }, 'No changes')])
    ),
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
