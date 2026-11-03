import type { BranchRef, RefsResult } from '../shared/protocol.ts'
import { h, icon } from './dom.ts'
import { groupRemotes } from './format.ts'

export interface BranchesHost {
  refs: RefsResult | null
  /** Full ref names the log is filtered to. */
  filtered: string[]
  collapsed: Set<string>
  onCollapse(): void
  /** Single click: select the commit in the log. */
  select(hash: string): void
  /** Double click: show only this ref. */
  filterTo(full: string): void
  menu(event: MouseEvent, ref: BranchRef & { kind: 'local' | 'remote' | 'tag' | 'head' }): void
}

export function renderBranches(container: HTMLElement, host: BranchesHost, query: string): void {
  const refs = host.refs
  if (!refs) {
    container.replaceChildren()
    return
  }
  const q = query.trim().toLowerCase()
  const rows: HTMLElement[] = []
  const matches = (name: string) => !q || name.toLowerCase().includes(q)

  const group = (id: string, label: string, depth: number, count: number) => {
    const open = q !== '' || !host.collapsed.has(id)
    rows.push(
      h(
        'div',
        {
          class: 'node-row group',
          style: `padding-left:${4 + depth * 14}px`,
          onclick: () => {
            if (host.collapsed.has(id)) host.collapsed.delete(id)
            else host.collapsed.add(id)
            host.onCollapse()
          }
        },
        h('span', { class: 'twisty' }, icon(open ? 'chevronDown' : 'chevronRight')),
        h('span', { class: 'label' }, label),
        h('span', { class: 'count' }, String(count))
      )
    )
    return open
  }

  const leaf = (ref: BranchRef, kind: 'local' | 'remote' | 'tag' | 'head', label: string, depth: number, current = false) => {
    const filtered = host.filtered.includes(ref.full)
    rows.push(
      h(
        'div',
        {
          class: `node-row${filtered ? ' filtered' : ''}`,
          style: `padding-left:${4 + depth * 14 + 16}px`,
          title: `${ref.full}${ref.upstream ? `\nTracking ${ref.upstream}` : ''}\nDouble-click to show only this ${kind === 'tag' ? 'tag' : 'branch'}`,
          onclick: () => ref.hash && host.select(ref.hash),
          ondblclick: () => host.filterTo(ref.full),
          oncontextmenu: (event: MouseEvent) => {
            event.preventDefault()
            host.menu(event, { ...ref, kind })
          }
        },
        current ? icon('star', 'ic-head') : icon(kind === 'tag' ? 'tag' : 'branch', `ic-${kind}`),
        h('span', { class: 'label' }, label),
        ref.upstream && kind === 'local' ? h('span', { class: 'track' }, `→ ${ref.upstream.replace(/^refs\/remotes\//, '')}`) : null
      )
    )
  }

  if (refs.head.hash && matches('HEAD')) {
    leaf({ name: 'HEAD', full: 'HEAD', hash: refs.head.hash }, 'head', 'HEAD (Current Branch)', 0, true)
  }

  const locals = refs.locals.filter((r) => matches(r.name))
  if (locals.length && group('local', 'Local', 0, locals.length)) {
    for (const ref of locals) leaf(ref, 'local', ref.name, 1, ref.name === refs.head.branch)
  }

  const remotes = refs.remotes.filter((r) => matches(r.name))
  if (remotes.length && group('remote', 'Remote', 0, remotes.length)) {
    for (const [remote, list] of groupRemotes(remotes)) {
      if (group(`remote/${remote}`, remote, 1, list.length)) {
        for (const ref of list) leaf(ref, 'remote', ref.name.slice(remote.length + 1), 2)
      }
    }
  }

  const tags = refs.tags.filter((r) => matches(r.name))
  if (tags.length && group('tags', 'Tags', 0, tags.length)) {
    for (const ref of tags) leaf(ref, 'tag', ref.name, 1)
  }

  container.replaceChildren(...rows)
}
