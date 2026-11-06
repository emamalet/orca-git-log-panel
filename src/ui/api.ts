// Thin typed wrapper over the frame's `window.orca` (no Node, no network in a frame).
import type {
  ActionRequest,
  ActionResult,
  CheckResult,
  CommitDetails,
  FileChange,
  FileDiff,
  LogFilter,
  LogPage,
  RefsResult,
  RepoResult,
  RewriteKind
} from '../shared/protocol.ts'

interface Disposable {
  dispose(): void
}

interface FrameOrca {
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<any>
    on(event: string, handler: (payload: any) => void): Disposable
  }
  on(event: string, handler: (payload: any) => void): Disposable
  host: { has(method: string): boolean; call(method: string, params?: unknown): Promise<any> }
  document?: { get(): Promise<{ content: { kind: string; text?: string } }> }
}

export const orca = (globalThis as unknown as { orca: FrameOrca }).orca

const LONG = { timeoutMs: 120_000 }

export const api = {
  resolve: (root?: string, workspaceId?: string): Promise<RepoResult> =>
    orca.plugin.request('repo.resolve', root ? { root } : workspaceId ? { workspaceId } : {}),
  refs: (root: string): Promise<RefsResult> => orca.plugin.request('repo.refs', { root }),
  watch: (root: string): Promise<{ ok: boolean }> => orca.plugin.request('repo.watch', { root }),
  page: (root: string, filter: LogFilter, skip: number, limit?: number): Promise<LogPage> =>
    orca.plugin.request('log.page', { root, filter, skip, ...(limit ? { limit } : {}) }, LONG),
  details: (root: string, hash: string): Promise<CommitDetails> => orca.plugin.request('commit.details', { root, hash }),
  diff: (root: string, hash: string, file: FileChange, wholeFile: boolean): Promise<FileDiff> =>
    orca.plugin.request('file.diff', { root, hash, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), wholeFile }, LONG),
  check: (root: string, kind: RewriteKind, hashes: string[]): Promise<CheckResult> =>
    orca.plugin.request('action.check', { root, kind, hashes }, LONG),
  run: (root: string, action: ActionRequest): Promise<ActionResult> => orca.plugin.request('action.run', { root, action }, LONG),
  openTab: (workspaceId?: string | null): Promise<{ ok: boolean; reason?: string }> =>
    orca.plugin.request('tab.open', workspaceId ? { workspaceId } : {})
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as Error).message)
  return String(error)
}

/** Copies through a selection: frames refuse navigator.clipboard. Call it from a click or key press. */
export function copyText(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  const focused = document.activeElement as HTMLElement | null
  document.body.append(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  focused?.focus({ preventScroll: true })
  return copied
}
