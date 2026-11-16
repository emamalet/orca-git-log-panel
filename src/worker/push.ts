import type { ActionRequest, PushPlan } from '../shared/protocol.ts'
import { lastLines, type Git } from './git.ts'
import { readHead } from './log.ts'

const MAX_COMMITS = 200
const FS = '\x1f'

async function listRemotes(git: Git): Promise<string[]> {
  return (await git.out(['remote'])).split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
}

async function assertBranchName(git: Git, name: string): Promise<string> {
  if (!name || name.startsWith('-') || !(await git.run(['check-ref-format', `refs/heads/${name}`])).ok) {
    throw new Error(`"${name}" is not a valid branch name.`)
  }
  return name
}

async function commitsOf(git: Git, args: string[], limit: number): Promise<{ hash: string; subject: string }[]> {
  const result = await git.run(['log', `--format=%H${'%x1f'}%s`, `-n${limit}`, ...args, '--'])
  if (!result.ok) return []
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ''] = line.split(FS)
      return { hash, subject }
    })
}

/** What pushing the current branch to `remote`/`remoteBranch` (by default its upstream) would send and discard. */
export async function checkPush(git: Git, remoteChoice?: string, branchChoice?: string): Promise<PushPlan> {
  try {
    const head = await readHead(git)
    if (!head.hash) return { ok: false, reason: 'The repository has no commits.' }
    if (!head.branch) return { ok: false, reason: 'HEAD is detached: check out a branch to push it.' }
    const remotes = await listRemotes(git)
    if (!remotes.length) return { ok: false, reason: 'This repository has no remote to push to.' }
    const tracking = await git.run(['for-each-ref', `--format=%(upstream:remotename)${'%1f'}%(upstream:remoteref)`, `refs/heads/${head.branch}`])
    const [upRemote = '', upRef = ''] = tracking.ok ? tracking.stdout.trim().split(FS) : []
    const upBranch = upRef.replace(/^refs\/heads\//, '')
    const remote = remoteChoice || upRemote || (remotes.includes('origin') ? 'origin' : remotes[0])
    if (!remotes.includes(remote)) return { ok: false, reason: `Unknown remote ${remote}.` }
    const remoteBranch = await assertBranchName(git, (branchChoice ?? '').trim() || (remote === upRemote && upBranch) || head.branch)
    const publish = !upRemote
    const tracked = `refs/remotes/${remote}/${remoteBranch}`
    const known = await git.run(['rev-parse', '-q', '--verify', `${tracked}^{commit}`])
    const remoteHash = known.ok ? known.stdout.trim() : null
    const commits = await commitsOf(git, remoteHash ? [`${remoteHash}..${head.hash}`] : [head.hash, '--not', `--remotes=${remote}`], MAX_COMMITS + 1)
    const lost = remoteHash ? await commitsOf(git, [`${head.hash}..${remoteHash}`], 50) : []
    return {
      ok: true,
      branch: head.branch,
      hash: head.hash,
      remotes,
      remote,
      remoteBranch,
      publish,
      commits: commits.slice(0, MAX_COMMITS),
      more: commits.length > MAX_COMMITS,
      lost,
      remoteHash
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Pushes exactly the commit that was reviewed, refusing if HEAD moved since. */
export async function push(git: Git, action: Extract<ActionRequest, { kind: 'push' }>): Promise<string> {
  const head = await readHead(git)
  if (head.branch !== action.branch || head.hash !== action.hash) throw new Error('The branch changed since the push was prepared. Try again.')
  if (!(await listRemotes(git)).includes(action.remote)) throw new Error(`Unknown remote ${action.remote}.`)
  const remoteBranch = await assertBranchName(git, action.remoteBranch)
  const lease = action.force
    ? [`--force-with-lease=refs/heads/${remoteBranch}${action.expect && /^[0-9a-f]{40}$/.test(action.expect) ? `:${action.expect}` : ''}`]
    : []
  const result = await git.run(['push', ...lease, action.remote, `${action.hash}:refs/heads/${remoteBranch}`], { timeoutMs: 120_000 })
  if (!result.ok) {
    const reason = lastLines(result.stderr || result.stdout, 6)
    throw new Error(`Push failed.${reason ? `\n${reason}` : ''}`)
  }
  // Pushing a commit (not the branch) leaves the remote-tracking ref alone: update it so ahead/behind are right.
  await git.run(['update-ref', `refs/remotes/${action.remote}/${remoteBranch}`, action.hash])
  if (action.setUpstream) {
    await git.out(['config', `branch.${action.branch}.remote`, action.remote])
    await git.out(['config', `branch.${action.branch}.merge`, `refs/heads/${remoteBranch}`])
  }
  const where = `${action.remote}/${remoteBranch}`
  return action.force ? `Force-pushed ${action.branch} to ${where}.` : `Pushed ${action.branch} to ${where}.`
}

export async function fetchAll(git: Git): Promise<string> {
  const result = await git.run(['fetch', '--all', '--prune'], { timeoutMs: 120_000 })
  if (!result.ok) {
    const reason = lastLines(result.stderr || result.stdout, 6)
    throw new Error(`Fetch failed.${reason ? `\n${reason}` : ''}`)
  }
  return 'Fetched all remotes.'
}
