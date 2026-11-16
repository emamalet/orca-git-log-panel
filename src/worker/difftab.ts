import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { DiffTabRequest, FileChange } from '../shared/protocol.ts'
import type { ListedWorkspace, Workspace } from './repo.ts'

/** Folder, inside the workspace, holding the small files that diff tabs open. */
export const DIFF_DIR = '.orca-git-log'
const KEEP = 40

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const safe = (text: string) => text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file'

/** `name.ts @1a2b3c4d.gitdiff`; the parent folder is added when another changed file has the same name. */
export function diffAnchorName(files: FileChange[], index: number, hash: string): string {
  const path = files[index].path
  const name = baseName(path)
  const parts = path.split('/')
  const twin = files.some((f, i) => i !== index && baseName(f.path) === name) && parts.length > 1
  return `${safe(name)}${twin ? ` (${safe(parts[parts.length - 2])})` : ''} @${hash.slice(0, 8)}.gitdiff`
}

export function validDiffRequest(input: unknown): DiffTabRequest {
  const req = (input ?? {}) as DiffTabRequest
  const isText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length < 4096
  if (!isText(req.root) || !/^[0-9a-f]{4,64}$/i.test(String(req.hash))) throw new Error('Invalid diff request.')
  if (!Array.isArray(req.files) || !req.files.length || req.files.length > 20_000) throw new Error('Invalid diff request.')
  const files = req.files.map((f) => {
    if (!isText(f?.path) || !isText(f?.status) || (f.oldPath !== undefined && !isText(f.oldPath))) throw new Error('Invalid diff request.')
    return { status: f.status, path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) }
  })
  const index = Math.floor(Number(req.index))
  if (!(index >= 0 && index < files.length)) throw new Error('Invalid diff request.')
  return { root: req.root, hash: req.hash, files, index, ...(isText(req.workspaceId) ? { workspaceId: req.workspaceId } : {}) }
}

/** The local workspace to put the anchor in: the one asked for, else the one rooted at `root`. */
export function pickWorkspace(workspaces: ListedWorkspace[], root: string, prefer?: string): Workspace | null {
  const local = workspaces.filter((w) => (!w.hostId || w.hostId === 'local') && existsSync(w.path))
  const at = (w: ListedWorkspace) => relative(root, w.path)
  const inside = (w: ListedWorkspace) => !at(w).startsWith('..') && !isAbsolute(at(w))
  const found = local.find((w) => w.id === prefer && inside(w)) ?? local.find((w) => at(w) === '') ?? local.find(inside)
  return found ? { id: found.id, path: found.path } : null
}

/** Writes the anchor a diff tab opens, removing the oldest ones beyond a few dozen. */
export function writeDiffAnchor(workspacePath: string, req: DiffTabRequest): string {
  const dir = join(workspacePath, DIFF_DIR)
  mkdirSync(dir, { recursive: true })
  const name = diffAnchorName(req.files, req.index, req.hash)
  const { workspaceId: _, ...content } = req
  writeFileSync(join(dir, name), `${JSON.stringify(content)}\n`)
  const old = readdirSync(dir)
    .filter((file) => file.endsWith('.gitdiff') && file !== name)
    .map((file) => ({ file, time: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(KEEP - 1)
  for (const { file } of old) {
    try {
      unlinkSync(join(dir, file))
    } catch {
      // Still open somewhere, or already gone: harmless.
    }
  }
  return `${DIFF_DIR}/${name}`
}
