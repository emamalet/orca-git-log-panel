import type { ActionRequest, ActionResult, CheckResult, RewriteKind } from '../shared/protocol.ts'
import { lastLines, type Git } from './git.ts'
import { readHead } from './log.ts'
import { fetchAll, push } from './push.ts'
import {
  operationInProgress,
  planFor,
  pushedTo,
  rangeHashes,
  readFirstParentHistory,
  runRebase,
  selectRange,
  type HistoryEntry
} from './rebase.ts'

const HASH = /^[0-9a-f]{40}$/

function assertHashes(hashes: unknown): string[] {
  if (!Array.isArray(hashes) || !hashes.length || !hashes.every((h) => typeof h === 'string' && HASH.test(h))) {
    throw new Error('Invalid commit selection.')
  }
  return hashes as string[]
}

/** `name` if it is an existing local branch. */
async function localBranch(git: Git, name: unknown): Promise<string> {
  if (typeof name !== 'string' || !name || name.startsWith('-') || !(await git.run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`])).ok) {
    throw new Error(`No local branch ${String(name)}.`)
  }
  return name
}

/** `ref` if it is the full name of an existing local or remote-tracking branch. */
async function branchRef(git: Git, ref: unknown): Promise<string> {
  if (typeof ref !== 'string' || !/^refs\/(heads|remotes)\//.test(ref) || !(await git.run(['show-ref', '--verify', '--quiet', ref])).ok) {
    throw new Error(`No branch ${String(ref)}.`)
  }
  return ref
}

/** Tracked files with uncommitted changes (untracked files never block a checkout git can do). */
export async function dirtyFiles(git: Git): Promise<string[]> {
  const entries = (await git.out(['status', '--porcelain', '-z', '--untracked-files=no'])).split('\0')
  const files: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return files
}

async function assertName(git: Git, name: string, kind: 'branch' | 'tag'): Promise<string> {
  const trimmed = name.trim()
  const args = kind === 'branch' ? ['check-ref-format', '--branch', trimmed] : ['check-ref-format', `refs/tags/${trimmed}`]
  if (!trimmed || trimmed.startsWith('-') || !(await git.run(args)).ok) throw new Error(`"${trimmed}" is not a valid ${kind} name.`)
  return trimmed
}

/** `hashes` sorted oldest first (topological), for cherry-pick. */
async function oldestFirst(git: Git, hashes: string[]): Promise<string[]> {
  const out = await git.out(['rev-list', '--no-walk=sorted', '--topo-order', ...hashes])
  const order = out.split(/\r?\n/).filter(Boolean)
  return order.reverse()
}

async function sequencer(git: Git, verb: 'cherry-pick' | 'revert', args: string[]): Promise<void> {
  const result = await git.run([verb, ...args], { timeoutMs: 120_000 })
  if (!result.ok) {
    const reason = lastLines(result.stderr || result.stdout, 4)
    if ((await operationInProgress(git)) === verb) await git.run([verb, '--abort'])
    throw new Error(`${verb === 'revert' ? 'Revert' : 'Cherry-pick'} failed and was aborted.${reason ? `\n${reason}` : ''}`)
  }
}

function messagesOf(history: HistoryEntry[]): Map<string, string> {
  return new Map(history.map((entry) => [entry.hash, entry.message]))
}

/** Whether a rewrite of `hashes` is possible, the commits it touches and where they were pushed. */
export async function checkRewrite(git: Git, kind: RewriteKind, hashes: string[]): Promise<CheckResult> {
  try {
    assertHashes(hashes)
    const operation = await operationInProgress(git)
    if (operation) return { ok: false, reason: `A ${operation} is in progress. Finish or abort it first.` }
    const head = await readHead(git)
    if (!head.hash) return { ok: false, reason: 'The repository has no commits.' }
    const history = await readFirstParentHistory(git)
    if (kind === 'undo') {
      if (hashes.length !== 1 || hashes[0] !== head.hash) return { ok: false, reason: 'Only the latest commit (HEAD) can be undone.' }
      if (!history[0]?.parents.length) return { ok: false, reason: 'The first commit of a repository cannot be undone.' }
      return { ok: true, pushed: await pushedTo(git, head.hash), commits: [history[0]] }
    }
    if (kind === 'squash' && hashes.length < 2) return { ok: false, reason: 'Select at least two commits to squash.' }
    if (kind === 'reword' && hashes.length !== 1) return { ok: false, reason: 'Select one commit to edit its message.' }
    const range = selectRange(history, rangeHashes(kind, hashes, history))
    return {
      ok: true,
      pushed: await pushedTo(git, range.commits[0].hash),
      commits: range.commits.map(({ hash, subject, message }) => ({ hash, subject, message }))
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

async function rewrite(git: Git, action: Extract<ActionRequest, { kind: 'squash' | 'fixup' | 'drop' | 'reword' | 'rebase' }>): Promise<string> {
  const operation = await operationInProgress(git)
  if (operation) throw new Error(`A ${operation} is in progress. Finish or abort it first.`)
  const history = await readFirstParentHistory(git)
  const messages = messagesOf(history)
  if (action.kind === 'rebase') {
    const hashes = assertHashes(action.plan?.map((item) => item.hash))
    const range = selectRange(history, hashes)
    const expected = new Set(range.commits.map((c) => c.hash))
    if (hashes.length !== expected.size || !hashes.every((h) => expected.has(h))) {
      throw new Error('The branch changed since the rebase was planned. Refresh and try again.')
    }
    await runRebase(git, range.base, action.plan, messages)
    return 'Rebase finished.'
  }
  const hashes = assertHashes(action.kind === 'reword' ? [action.hash] : action.hashes)
  const range = selectRange(history, rangeHashes(action.kind, hashes, history))
  const message = action.kind === 'squash' || action.kind === 'reword' ? action.message : undefined
  if ((action.kind === 'squash' || action.kind === 'reword') && !message?.trim()) throw new Error('A commit message cannot be empty.')
  await runRebase(git, range.base, planFor(action.kind, range, hashes, message), messages)
  const n = hashes.length
  switch (action.kind) {
    case 'squash':
      return `Squashed ${n} commits.`
    case 'fixup':
      return n === 1 ? 'Fixed up into the previous commit.' : `Fixed up ${n - 1} commit${n > 2 ? 's' : ''}.`
    case 'drop':
      return `Dropped ${n} commit${n > 1 ? 's' : ''}.`
    default:
      return 'Commit message updated.'
  }
}

/** Thrown when `git branch -d` refuses an unmerged branch, so the UI can offer to force it. */
class NeedsForce extends Error {}

export async function runAction(git: Git, action: ActionRequest): Promise<ActionResult> {
  const previousHead = (await readHead(git)).hash ?? undefined
  try {
    const message = await perform(git, action)
    return { ok: true, message, ...(previousHead ? { previousHead } : {}) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), ...(error instanceof NeedsForce ? { needsForce: true } : {}) }
  }
}

async function perform(git: Git, action: ActionRequest): Promise<string> {
  switch (action.kind) {
    case 'checkout': {
      const target = action.target?.trim()
      if (!target || target.startsWith('-')) throw new Error('Invalid checkout target.')
      const label = HASH.test(target) ? target.slice(0, 8) : target
      const args = HASH.test(target) ? ['checkout', '--detach', target, '--'] : ['checkout', target, '--']
      if (!action.stash || !(await dirtyFiles(git)).length) {
        await git.out(args)
        return `Checked out ${label}.`
      }
      await git.out(['stash', 'push', '-m', `git-log: before checking out ${label}`])
      const result = await git.run(args)
      if (!result.ok) {
        await git.run(['stash', 'pop', '--index'])
        throw new Error(`Checkout failed; your changes were restored.\n${lastLines(result.stderr || result.stdout, 4)}`)
      }
      return `Checked out ${label}. Your changes were stashed (git stash pop restores them).`
    }
    case 'renameBranch': {
      const name = await localBranch(git, action.name)
      const newName = await assertName(git, action.newName, 'branch')
      await git.out(['branch', '-m', name, newName])
      return `Renamed ${name} to ${newName}.`
    }
    case 'deleteBranch': {
      const name = await localBranch(git, action.name)
      if ((await readHead(git)).branch === name) throw new Error('The current branch cannot be deleted.')
      const result = await git.run(['branch', action.force ? '-D' : '-d', name])
      if (!result.ok) {
        if (/not fully merged/i.test(result.stderr)) throw new NeedsForce(`${name} is not fully merged.`)
        throw new Error(lastLines(result.stderr || result.stdout, 4) || `Could not delete ${name}.`)
      }
      return `Deleted branch ${name}.`
    }
    case 'merge':
    case 'rebaseOnto': {
      const ref = await branchRef(git, action.ref)
      const operation = await operationInProgress(git)
      if (operation) throw new Error(`A ${operation} is in progress. Finish or abort it first.`)
      const short = ref.replace(/^refs\/(heads|remotes)\//, '')
      if (action.kind === 'merge') {
        const result = await git.run(['merge', '--no-edit', ref], { timeoutMs: 120_000 })
        if (!result.ok) {
          const reason = lastLines(result.stderr || result.stdout, 4)
          if ((await operationInProgress(git)) === 'merge') await git.run(['merge', '--abort'])
          throw new Error(`Merging ${short} failed and was aborted.${reason ? `\n${reason}` : ''}`)
        }
        return /Already up to date/i.test(result.stdout) ? `Already up to date with ${short}.` : `Merged ${short} into the current branch.`
      }
      const result = await git.run(['rebase', '--autostash', ref], { timeoutMs: 120_000 })
      if (!result.ok) {
        const reason = lastLines(result.stderr || result.stdout, 4)
        if ((await operationInProgress(git)) === 'rebase') await git.run(['rebase', '--abort'])
        throw new Error(`Rebasing onto ${short} failed and was aborted.${reason ? `\n${reason}` : ''}`)
      }
      return `Rebased the current branch onto ${short}.`
    }
    case 'fetch':
      return fetchAll(git)
    case 'push':
      return push(git, action)
    case 'branch': {
      const [hash] = assertHashes([action.hash])
      const name = await assertName(git, action.name, 'branch')
      await git.out(action.checkout ? ['checkout', '-b', name, hash, '--'] : ['branch', name, hash])
      return action.checkout ? `Created and checked out ${name}.` : `Created branch ${name}.`
    }
    case 'tag': {
      const [hash] = assertHashes([action.hash])
      const name = await assertName(git, action.name, 'tag')
      await git.out(['tag', name, hash])
      return `Created tag ${name}.`
    }
    case 'cherryPick': {
      const hashes = await oldestFirst(git, assertHashes(action.hashes))
      await sequencer(git, 'cherry-pick', hashes)
      return `Cherry-picked ${hashes.length} commit${hashes.length > 1 ? 's' : ''}.`
    }
    case 'revert': {
      const hashes = (await oldestFirst(git, assertHashes(action.hashes))).reverse()
      await sequencer(git, 'revert', ['--no-edit', ...hashes])
      return `Reverted ${hashes.length} commit${hashes.length > 1 ? 's' : ''}.`
    }
    case 'reset': {
      const [hash] = assertHashes([action.hash])
      if (!['soft', 'mixed', 'hard', 'keep'].includes(action.mode)) throw new Error('Invalid reset mode.')
      await git.out(['reset', `--${action.mode}`, hash, '--'])
      return `Reset to ${hash.slice(0, 8)} (${action.mode}).`
    }
    case 'undo': {
      const check = await checkRewrite(git, 'undo', [action.hash])
      if (!check.ok) throw new Error(check.reason)
      await git.out(['reset', '--soft', 'HEAD~1', '--'])
      return 'Commit undone; its changes are staged.'
    }
    case 'squash':
    case 'fixup':
    case 'drop':
    case 'reword':
    case 'rebase':
      return rewrite(git, action)
    default:
      throw new Error(`Unknown action ${(action as { kind: string }).kind}.`)
  }
}
