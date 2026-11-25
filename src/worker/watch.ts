import { watch, type FSWatcher } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { isWslPath, type Git } from './git.ts'

// Only these paths (relative to a git dir) change what the log shows.
const RELEVANT = /^(HEAD|ORIG_HEAD|FETCH_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|packed-refs|refs|rebase-merge|rebase-apply|worktrees)(\/|$)/

export function isRelevant(file: string | null): boolean {
  if (!file) return true
  const path = file.split(sep).join('/')
  return !path.endsWith('.lock') && RELEVANT.test(path)
}

export interface RepoWatcher {
  close(): void
}

/** What the log shows, in one line per ref, to notice changes by comparing. */
export async function repoFingerprint(git: Git): Promise<string> {
  const [head, refs] = await Promise.all([
    git.run(['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD']),
    git.run(['for-each-ref', '--format=%(refname) %(objectname)'])
  ])
  return `${head.stdout}\n${refs.stdout}`
}

/**
 * Windows cannot watch a \\wsl.localhost folder (fs.watch fails with EISDIR), so a WSL repository
 * is polled instead: HEAD and the refs, every few seconds.
 */
function pollRepo(git: Git, onChange: () => void, intervalMs: number): RepoWatcher {
  let last: string | null = null
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const now = await repoFingerprint(git)
      if (last !== null && now !== last) onChange()
      last = now
    } finally {
      busy = false
    }
  }, intervalMs)
  return { close: () => clearInterval(timer) }
}

/** Calls `onChange` (debounced) when refs, HEAD or a sequencer state of the repository change. */
export async function watchRepo(git: Git, root: string, onChange: () => void, delayMs = 400, pollMs = 4000): Promise<RepoWatcher> {
  const [gitDir, commonDir] = (await git.out(['rev-parse', '--git-dir', '--git-common-dir']))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((dir) => resolve(root, git.fromGit(dir.trim())))
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, delayMs)
  }
  if (isWslPath(commonDir) && process.platform === 'win32') return pollRepo(git, fire, pollMs)
  const watchers: FSWatcher[] = []
  const dirs = [commonDir]
  if (gitDir && gitDir !== commonDir && relative(commonDir, gitDir).startsWith('..')) dirs.push(gitDir)
  for (const dir of dirs) {
    try {
      const watcher = watch(dir, { recursive: true }, (_event, file) => {
        if (isRelevant(file ? file.toString() : null)) fire()
      })
      watcher.on('error', () => watcher.close())
      watchers.push(watcher)
    } catch {
      // Recursive watching is unavailable (older Linux Node): the panel still refreshes on focus.
    }
  }
  return {
    close() {
      clearTimeout(timer)
      watchers.forEach((w) => w.close())
    }
  }
}
