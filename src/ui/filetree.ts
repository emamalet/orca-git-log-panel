export interface DirNode {
  /** Shown name; single-child folder chains are joined, like `src/main/java`. */
  name: string
  /** Full path from the repository root, used as the key that remembers folding. */
  path: string
  dirs: DirNode[]
  /** Indexes into the list of paths, sorted by file name. */
  files: number[]
  count: number
}

/** Groups changed paths into folders, compacting folders whose only child is one folder. */
export function buildFileTree(paths: string[]): DirNode {
  type Raw = { dirs: Map<string, Raw>; files: number[] }
  const top: Raw = { dirs: new Map(), files: [] }
  paths.forEach((path, index) => {
    const parts = path.split('/')
    let node = top
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part)
      if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [] }))
      node = next
    }
    node.files.push(index)
  })
  const fileName = (i: number) => paths[i].slice(paths[i].lastIndexOf('/') + 1)
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  const convert = (raw: Raw, name: string, path: string): DirNode => {
    while (!raw.files.length && raw.dirs.size === 1 && name) {
      const [child, next] = [...raw.dirs][0]
      name = `${name}/${child}`
      path = `${path}/${child}`
      raw = next
    }
    const dirs = [...raw.dirs]
      .map(([child, next]) => convert(next, child, path ? `${path}/${child}` : child))
      .sort((a, b) => byName(a.name, b.name))
    const files = raw.files.sort((a, b) => byName(fileName(a), fileName(b)))
    return { name, path, dirs, files, count: files.length + dirs.reduce((n, d) => n + d.count, 0) }
  }
  return convert(top, '', '')
}
