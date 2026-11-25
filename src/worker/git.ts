import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { parseWslPath, run as runInWsl, toWslPath, wslArgs, type Runner, type WslPath } from './wsl.ts'

export interface GitResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

export interface GitOptions {
  env?: Record<string, string>
  timeoutMs?: number
}

export interface Git {
  run(args: string[], options?: GitOptions): Promise<GitResult>
  /** Runs and returns stdout, throwing a readable Error when git fails. */
  out(args: string[], options?: GitOptions): Promise<string>
  /** An absolute path git printed, as this worker opens it. */
  fromGit(path: string): string
  /** A path this worker uses, as git sees it (for file names handed to git). */
  toGit(path: string): string
  /** Where temporary files that git reads are written. */
  tempDir(): string
}

export class GitError extends Error {
  constructor(message: string, readonly result: GitResult) {
    super(message)
  }
}

export function lastLines(text: string, count = 6): string {
  return text.trim().split(/\r?\n/).slice(-count).join('\n')
}

/** `\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...`, a WSL file system seen from Windows. */
export const isWslPath = (path: string) => /^[\\/]{2}wsl(\.localhost|\$)[\\/]/i.test(path)

const GIT_FLAGS = ['-c', 'core.quotepath=off', '-c', 'color.ui=false', '-c', 'log.showSignature=false']

/**
 * Git for a repository inside WSL, seen from Windows as \\wsl.localhost\<distro>\...: git runs in
 * the distro through wsl.exe, with Linux paths, so its own config, file modes and line endings apply.
 */
function createWslGit(root: string, wsl: WslPath, runner: Runner): Git {
  const run = async (args: string[], options: GitOptions = {}): Promise<GitResult> => {
    const env = { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...options.env }
    const result = await runner('wsl.exe', wslArgs(wsl.distro, wsl.linuxPath, 'git', [...GIT_FLAGS, ...args], env), options.timeoutMs ?? 60_000)
    return { ok: result.code === 0, ...result }
  }
  const drive = /^([a-z]):[\\/]*(.*)$/i
  return {
    run,
    async out(args, options) {
      const result = await run(args, options)
      if (!result.ok) throw new GitError(lastLines(result.stderr || result.stdout) || `git ${args[0]} failed`, result)
      return result.stdout
    },
    fromGit: (path) => (path.startsWith('/') ? toWslPath(wsl.distro, path, wsl.share) : path),
    toGit(path) {
      const inside = parseWslPath(path)
      if (inside) return inside.linuxPath
      const onDrive = drive.exec(path)
      return onDrive ? `/mnt/${onDrive[1].toLowerCase()}/${onDrive[2].replace(/\\/g, '/')}` : path
    },
    tempDir: () => toWslPath(wsl.distro, '/tmp', wsl.share)
  }
}

export function createGit(root: string, gitPath = 'git', { platform = process.platform, runner = runInWsl }: { platform?: string; runner?: Runner } = {}): Git {
  const wsl = platform === 'win32' ? parseWslPath(root) : null
  if (wsl) return createWslGit(root, wsl, runner)
  // Git for Windows sees WSL files as owned by someone else and refuses them ("dubious ownership").
  // Set through the environment so git processes started by git itself (rebase exec) inherit it.
  const trust = isWslPath(root) ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' } : {}
  const run = (args: string[], options: GitOptions = {}) =>
    new Promise<GitResult>((resolve) => {
      execFile(
        gitPath,
        [...GIT_FLAGS, ...args],
        {
          cwd: root,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...trust, ...options.env },
          maxBuffer: 64 * 1024 * 1024,
          timeout: options.timeoutMs ?? 60_000,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : null) : 0
          resolve({ ok: !error, code, stdout: String(stdout), stderr: String(stderr || (error && !stderr ? error.message : '')) })
        }
      )
    })
  return {
    run,
    async out(args, options) {
      const result = await run(args, options)
      if (!result.ok) throw new GitError(lastLines(result.stderr || result.stdout) || `git ${args[0]} failed`, result)
      return result.stdout
    },
    fromGit: (path) => path,
    toGit: (path) => path,
    tempDir: () => tmpdir()
  }
}
