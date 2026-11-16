// The panel/editor <-> worker contract. Both sides import these types; nothing here runs.

export interface RepoInfo {
  root: string
  name: string
  workspaceId: string | null
  head: { branch: string | null; hash: string | null }
  /** A sequencer operation left in progress (by a terminal, say); rewrites are refused while set. */
  operation: 'rebase' | 'merge' | 'cherry-pick' | 'revert' | null
}

/** A local workspace the focused context could be, when several share its name and branch. */
export interface WorkspaceChoice {
  id: string
  name: string
  path: string
  branch: string
}

export type RepoResult = { ok: true; repo: RepoInfo } | { ok: false; reason: string; choices?: WorkspaceChoice[] }

export interface BranchRef {
  /** Short name: `main`, `origin/main`, `v1.0`. */
  name: string
  /** Full ref name: `refs/heads/main`. */
  full: string
  hash: string
  upstream?: string
}

/** Where the current branch stands against its upstream. */
export interface BranchStatus {
  /** Short upstream name (origin/main), or null when the branch tracks nothing. */
  upstream: string | null
  /** Commits to push. */
  ahead: number
  /** Commits to pull. */
  behind: number
}

export interface RefsResult {
  head: { branch: string | null; hash: string | null }
  status: BranchStatus
  operation: RepoInfo['operation']
  locals: BranchRef[]
  remotes: BranchRef[]
  tags: BranchRef[]
  users: string[]
  me: string | null
}

export interface CommitRow {
  hash: string
  parents: string[]
  author: string
  email: string
  authorTime: number
  committer: string
  commitTime: number
  subject: string
  /** Full ref names decorating this commit; `HEAD` when HEAD is detached here. */
  refs: string[]
}

export interface LogFilter {
  text?: string
  regex?: boolean
  matchCase?: boolean
  /** Revisions to show; empty means every branch, remote branch and tag. */
  branches?: string[]
  users?: string[]
  /** Unix seconds. */
  since?: number
  until?: number
  paths?: string[]
}

export interface LogPage {
  commits: CommitRow[]
  hasMore: boolean
}

export interface FileChange {
  status: string
  path: string
  oldPath?: string
  /** For a multi-commit selection: the file is diffed from ase (a commit, or the empty tree) to 	ip. */
  base?: string
  tip?: string
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  authorTime: number
  committer: string
  committerEmail: string
  commitTime: number
  message: string
  files: FileChange[]
  branches: string[]
}

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

export interface DiffLine {
  kind: ' ' | '+' | '-'
  text: string
  /** Line number in the old file (context and deletions). */
  old?: number
  /** Line number in the new file (context and additions). */
  new?: number
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  /** Function or section name git printed after the hunk range. */
  section: string
  lines: DiffLine[]
}

/** One file's changes in a commit, against its first parent. */
export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  /** The diff was cut short because it is too large. */
  truncated: boolean
  hunks: DiffHunk[]
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface PlanItem {
  hash: string
  action: RebaseAction
  /** pick: the final message of its group; reword/squash: this commit's new message. */
  message?: string
}

export type RewriteKind = 'squash' | 'fixup' | 'drop' | 'reword' | 'rebase' | 'undo'

export type ActionRequest =
  | { kind: 'checkout'; target: string; stash?: boolean }
  | { kind: 'branch'; hash: string; name: string; checkout: boolean }
  | { kind: 'tag'; hash: string; name: string }
  | { kind: 'cherryPick'; hashes: string[] }
  | { kind: 'revert'; hashes: string[] }
  | { kind: 'reset'; hash: string; mode: ResetMode }
  | { kind: 'undo'; hash: string }
  | { kind: 'squash'; hashes: string[]; message: string }
  | { kind: 'fixup'; hashes: string[] }
  | { kind: 'drop'; hashes: string[] }
  | { kind: 'reword'; hash: string; message: string }
  | { kind: 'rebase'; plan: PlanItem[] }
  | { kind: 'fetch' }
  | { kind: 'push'; branch: string; hash: string; remote: string; remoteBranch: string; setUpstream: boolean; force?: boolean; expect?: string }
  | { kind: 'renameBranch'; name: string; newName: string }
  | { kind: 'deleteBranch'; name: string; force?: boolean }
  | { kind: 'merge'; ref: string }
  | { kind: 'rebaseOnto'; ref: string }

export interface RangeCommit {
  hash: string
  subject: string
  message: string
}

export type CheckResult =
  | { ok: true; pushed: string[]; commits: RangeCommit[] }
  | { ok: false; reason: string }

export interface ActionResult {
  ok: boolean
  message: string
  /** HEAD before the action, so the UI can offer Undo. */
  previousHead?: string
  /** The branch is not fully merged: deleting it needs force. */
  needsForce?: boolean
}

/** What a push of the current branch would do. */
export type PushPlan =
  | {
      ok: true
      branch: string
      hash: string
      remotes: string[]
      remote: string
      remoteBranch: string
      /** The branch tracks nothing yet: the push publishes it and makes the target its upstream. */
      publish: boolean
      /** Commits the remote lacks, newest first (at most 200). */
      commits: { hash: string; subject: string }[]
      more: boolean
      /** Remote commits a push would discard (the branches diverged), newest first. */
      lost: { hash: string; subject: string }[]
      /** The remote branch's commit, for --force-with-lease. */
      remoteHash: string | null
    }
  | { ok: false; reason: string }

export type PatchResult =
  | { ok: true; name: string; size: number; text?: string; tooLarge?: boolean; path?: string }
  | { ok: false; reason: string; exists?: boolean }

/** What a diff tab shows: `files[index]` of commit `hash`; it can step through the other files. */
export interface DiffTabRequest {
  root: string
  hash: string
  files: FileChange[]
  index: number
  workspaceId?: string
}

declare module 'orca' {
  interface PluginRequests {
    'repo.resolve': { input: { root?: string; workspaceId?: string }; output: RepoResult }
    'repo.refs': { input: { root: string }; output: RefsResult }
    'repo.watch': { input: { root: string }; output: { ok: boolean } }
    'log.page': { input: { root: string; filter: LogFilter; skip: number; limit?: number }; output: LogPage }
    'commit.details': { input: { root: string; hash: string }; output: CommitDetails }
    'file.diff': { input: { root: string; hash: string; path: string; oldPath?: string; base?: string; tip?: string; wholeFile?: boolean }; output: FileDiff }
    'patch.create': { input: { root: string; hashes: string[]; path?: string; overwrite?: boolean }; output: PatchResult }
    'action.check': { input: { root: string; kind: RewriteKind; hashes: string[] }; output: CheckResult }
    'push.check': { input: { root: string; remote?: string; remoteBranch?: string }; output: PushPlan }
    'repo.dirty': { input: { root: string }; output: { files: string[] } }
    'selection.files': { input: { root: string; hashes: string[] }; output: { files: FileChange[] } }
    'action.run': { input: { root: string; action: ActionRequest }; output: ActionResult }
    'tab.open': { input: { workspaceId?: string }; output: { ok: boolean; reason?: string } }
    'diff.openTab': { input: DiffTabRequest; output: { ok: boolean; reason?: string } }
  }
  interface PluginPanelEvents {
    'repo.changed': { root: string }
  }
}
