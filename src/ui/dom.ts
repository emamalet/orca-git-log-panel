type Child = Node | string | number | null | undefined | false
type Props = Record<string, unknown> & { class?: string; style?: string; dataset?: Record<string, string> }

/** Builds an element: `on*` props become listeners, the rest attributes or properties. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (key in el && key !== 'style' && key !== 'list') (el as any)[key] = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, children)
  return el
}

export function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : String(child))
  }
}

/** An inline SVG icon from the set below. */
export function icon(name: keyof typeof ICONS, cls = ''): SVGSVGElement {
  const tpl = document.createElement('template')
  tpl.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICONS[name]}</svg>`
  return tpl.content.firstElementChild as SVGSVGElement
}

const stroke = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`

export const ICONS = {
  branch: `<circle cx="5" cy="3.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="12.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11" cy="5.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>${stroke('M5 5v6M11 7c0 3-6 2-6 4')}`,
  tag: `${stroke('M2.5 2.5h5l6 6-5 5-6-6z')}<circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>`,
  search: `<circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.2"/>${stroke('M10.2 10.2 14 14')}`,
  refresh: stroke('M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3'),
  chevronDown: stroke('M4 6l4 4 4-4'),
  chevronRight: stroke('M6 4l4 4-4 4'),
  close: stroke('M4 4l8 8M12 4l-8 8'),
  tree: stroke('M2.5 3h11M2.5 3v10M2.5 8h4M2.5 13h4M9 8h4.5M9 13h4.5'),
  details: `<rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>${stroke('M9.5 2.5v11')}`,
  external: stroke('M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5h-9.5v-9.5H6'),
  folder: stroke('M2 4.5h4l1.5 1.5H14v7H2z'),
  file: stroke('M4 2h5l3 3v9H4zM9 2v3h3'),
  up: stroke('M8 13V3M4 7l4-4 4 4'),
  down: stroke('M8 3v10M4 9l4 4 4-4'),
  star: `<path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill="currentColor"/>`,
  check: stroke('M3.5 8.5l3 3 6-7'),
  warning: `${stroke('M8 2l6.5 11.5h-13zM8 6.5v3.5')}<circle cx="8" cy="12" r=".7" fill="currentColor"/>`
} as const

export function clear(el: Element): void {
  el.replaceChildren()
}
