import type { BranchRef, RefsResult } from '../shared/protocol.ts'
import { h, icon } from './dom.ts'
import { groupRemotes } from './format.ts'

export interface BranchesHost {
  refs: RefsResult | null
  /** Full ref names the log is filtered to. */
  filtered: string[]
  collapsed: Set<string>
  onCollapse(): void
  /** Double click or the locate button: select the ref's commit in the log. */
  select(hash: string): void
  /** Click: show only this ref (again: show all); additive (Ctrl/Cmd+click) adds or removes it. */
  toggleFilter(full: string, additive: boolean): void
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

  const group = (id: string, label: string, depth: number, count: number, folder = false) => {
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
        folder ? icon('folder', 'ic-folder') : null,
        h('span', { class: 'label' }, label),
        h('span', { class: 'count' }, String(count))
      )
    )
    return open
  }

  const leaf = (ref: BranchRef, kind: 'local' | 'remote' | 'tag' | 'head', label: string, depth: number, current = false) => {
    const filtered = host.filtered.includes(ref.full)
    const what = kind === 'tag' ? 'tag' : 'branch'
    rows.push(
      h(
        'div',
        {
          class: `node-row leaf${filtered ? ' filtered' : ''}`,
          style: `padding-left:${4 + depth * 14 + 16}px`,
          role: 'treeitem',
          'aria-selected': String(filtered),
          title: [
            ref.full + (ref.upstream ? `\nTracking ${ref.upstream}` : ''),
            '',
            filtered ? 'Click: show all branches again' : `Click: show only this ${what}`,
            `Ctrl+click: ${filtered ? 'remove it from' : 'add it to'} the shown branches`,
            'Double-click: go to its latest commit'
          ].join('\n'),
          onclick: (event: MouseEvent) => {
            // The second click of a double-click must not undo the first one.
            if (event.detail > 1) return
            host.toggleFilter(ref.full, event.ctrlKey || event.metaKey)
          },
          ondblclick: () => ref.hash && host.select(ref.hash),
          oncontextmenu: (event: MouseEvent) => {
            event.preventDefault()
            host.menu(event, { ...ref, kind })
          }
        },
        current ? icon('star', 'ic-head') : icon(kind === 'tag' ? 'tag' : 'branch', `ic-${kind}`),
        h('span', { class: 'label' }, label),
        ref.upstream && kind === 'local' ? h('span', { class: 'track' }, `→ ${ref.upstream.replace(/^refs\/remotes\//, '')}`) : null,
        h('span', { class: 'spacer' }),
        ref.hash
          ? h(
              'button',
              {
                class: 'node-action',
                title: 'Go to its latest commit',
                onclick: (event: MouseEvent) => {
                  event.stopPropagation()
                  host.select(ref.hash!)
                },
                ondblclick: (event: MouseEvent) => event.stopPropagation()
              },
              icon('locate')
            )
          : null,
        filtered ? icon('filter', 'ic-filtered') : null
      )
    )
  }

  if (refs.head.hash && matches('HEAD')) {
    leaf({ name: 'HEAD', full: 'HEAD', hash: refs.head.hash }, 'head', 'HEAD (Current Branch)', 0, true)
  }

  /** Branches as folders by name prefix (`feature/x` under `feature`), folders first. */
  const nested = (items: { ref: BranchRef; rest: string }[], id: string, depth: number, kind: 'local' | 'remote') => {
    const folders = new Map<string, { ref: BranchRef; rest: string }[]>()
    const plain: { ref: BranchRef; rest: string }[] = []
    for (const item of items) {
      const slash = item.rest.indexOf('/')
      if (slash < 0) plain.push(item)
      else {
        const key = item.rest.slice(0, slash)
        if (!folders.has(key)) folders.set(key, [])
        folders.get(key)!.push({ ref: item.ref, rest: item.rest.slice(slash + 1) })
      }
    }
    for (const [name, list] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
      if (group(`${id}/${name}`, name, depth, list.length, true)) nested(list, `${id}/${name}`, depth + 1, kind)
    }
    for (const { ref, rest } of plain) leaf(ref, kind, rest, depth, kind === 'local' && ref.name === refs.head.branch)
  }

  const locals = refs.locals.filter((r) => matches(r.name))
  if (locals.length && group('local', 'Local', 0, locals.length)) {
    nested(locals.map((ref) => ({ ref, rest: ref.name })), 'local', 1, 'local')
  }

  const remotes = refs.remotes.filter((r) => matches(r.name))
  if (remotes.length && group('remote', 'Remote', 0, remotes.length)) {
    for (const [remote, list] of groupRemotes(remotes)) {
      if (group(`remote/${remote}`, remote, 1, list.length)) {
        nested(list.map((ref) => ({ ref, rest: ref.name.slice(remote.length + 1) })), `remote/${remote}`, 2, 'remote')
      }
    }
  }

  const tags = refs.tags.filter((r) => matches(r.name))
  if (tags.length && group('tags', 'Tags', 0, tags.length)) {
    for (const ref of tags) leaf(ref, 'tag', ref.name, 1)
  }

  container.replaceChildren(...rows)
}
