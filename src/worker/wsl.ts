import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

// Windows + WSL. Orca on Windows can run workspaces inside WSL through a separate runtime
// (`--environment wsl`). Their paths are Linux paths (/home/me/repo) that this Windows worker
// cannot open, so they are carried as \\wsl.localhost\<distro>\home\me\repo, which node's fs
// reads, and git for them runs inside the distro through wsl.exe: Git for Windows over that share
// is slow and reports every file whose mode differs as modified.

const UNC = /^([\\/]{2}wsl(?:\.localhost|\$))[\\/]([^\\/]+)(?:[\\/](.*))?$/i

export interface WslPath {
  /** `\\wsl.localhost` or `\\wsl$`, as the path spelled it. */
  share: string
  distro: string
  linuxPath: string
}

/** The parts of a `\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...` path, else null. */
export function parseWslPath(path: string): WslPath | null {
  const match = UNC.exec(path)
  if (!match) return null
  const rest = (match[3] ?? '').replace(/\\/g, '/')
  const linuxPath = posix.normalize(`/${rest}`).replace(/(.)\/+$/, '$1')
  return { share: match[1].replace(/\//g, '\\'), distro: match[2], linuxPath }
}

/** The Windows path of `linuxPath` inside `distro`. */
export function toWslPath(distro: string, linuxPath: string, share = '\\\\wsl.localhost'): string {
  const path = posix.normalize(linuxPath).replace(/\/+$/, '')
  return `${share}\\${distro}${path.replace(/\//g, '\\')}`
}

/**
 * Orca starts plugin workers with a trimmed environment; without APPDATA the orca CLI cannot find
 * its runtime, and wsl.exe expects USERPROFILE and SystemRoot. Missing ones are filled in.
 */
export function windowsEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Windows variable names are case-insensitive.
  const get = (name: string) => env[Object.keys(env).find((key) => key.toUpperCase() === name) ?? '']
  const home = get('USERPROFILE') || homedir()
  const fill: Record<string, string> = {
    USERPROFILE: home,
    APPDATA: win32.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: win32.join(home, 'AppData', 'Local'),
    SystemRoot: get('WINDIR') || 'C:\\Windows'
  }
  const out = { ...env }
  for (const [key, value] of Object.entries(fill)) if (!get(key.toUpperCase())) out[key] = value
  return out
}

/** wsl.exe prints its own messages in UTF-16LE; what runs inside the distro prints UTF-8. */
export function decodeWslOutput(buffer: Buffer): string {
  if (!buffer.length) return ''
  const bom = buffer[0] === 0xff && buffer[1] === 0xfe
  let utf16 = bom
  if (!bom && buffer.length % 2 === 0 && buffer[buffer.length - 2] === 0x0a && buffer[buffer.length - 1] === 0) {
    utf16 = true
    for (let i = 0; i < Math.min(buffer.length, 32); i += 2) if (buffer[i] === 0 || buffer[i + 1] !== 0) utf16 = false
  }
  return utf16 ? buffer.toString('utf16le').replace(/^\uFEFF/, '') : buffer.toString('utf8')
}

/** wsl.exe arguments running `command args` in `cwd` inside `distro`, with `env` set. */
export function wslArgs(distro: string, cwd: string, command: string, args: string[], env: Record<string, string> = {}): string[] {
  const vars = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  return ['-d', distro, '--cd', cwd, '--exec', 'env', ...vars, command, ...args]
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export type Runner = (file: string, args: string[], timeoutMs?: number) => Promise<RunResult>

/**
 * The environment for wsl.exe and the orca CLI. The worker runs as Electron in node mode
 * (ELECTRON_RUN_AS_NODE), which would make orca.exe run its arguments as a script.
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = windowsEnv(env)
  for (const key of Object.keys(out)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete out[key]
  return out
}

export const run: Runner = (file, args, timeoutMs = 30_000) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', env: childEnv(), maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : null) : 0
        const err = decodeWslOutput(stderr)
        resolve({ code, stdout: decodeWslOutput(stdout), stderr: err || (error && !err ? error.message : '') })
      }
    )
  })

// "[o]rca" keeps the pattern from matching the probe's own command line.
const PROBE = 'n=0; (pgrep -f "[o]rca.* serve" >/dev/null 2>&1 || ps -eo args 2>/dev/null | grep -q "[o]rca.* serve") && echo ORCA; for p in "$@"; do [ -e "$p" ] && n=$((n+1)); done; echo "paths $n"'

/** A probe answer's score: a running Orca server counts more than workspace paths that exist. */
export function scoreProbe(text: string): number {
  return (/^ORCA$/m.test(text) ? 100 : 0) + Number(/paths (\d+)/.exec(text)?.[1] ?? 0)
}

/**
 * The running distro an Orca environment lives in. Orca does not say, and two distros can hold the
 * same paths, so the one running an Orca server wins, then the one holding most sample paths.
 */
export async function findDistro(samplePaths: string[], runner: Runner = run): Promise<string | null> {
  const list = await runner('wsl.exe', ['-l', '-q', '--running'], 15_000)
  if (list.code !== 0) return null
  const distros = list.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trim())
    .filter((line) => line && !/^docker-desktop/i.test(line))
  const sample = samplePaths.filter((path) => path.startsWith('/')).slice(0, 5)
  const answers = await Promise.all(distros.map((distro) => runner('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', PROBE, 'probe', ...sample], 15_000)))
  let best: string | null = null
  let bestScore = 0
  answers.forEach((answer, i) => {
    const score = answer.code === 0 ? scoreProbe(answer.stdout) : 0
    if (score > bestScore) [best, bestScore] = [distros[i], score]
  })
  return best
}

export interface WslWorkspace {
  id: string
  name: string
  path: string
  branch: string | null
  hostId: string
}

interface CliWorktree {
  id?: string
  path?: string
  displayName?: string
  branch?: string | null
  hostId?: string
}

/**
 * The orca CLI. The worker's PATH can find Orca.exe itself first (the app, not the CLI), so the
 * CLI next to the running app, resources\bin\orca.exe, is preferred.
 */
export function orcaBinary(execPath = process.execPath, exists: (path: string) => boolean = existsSync): string {
  const candidates = [
    process.env.ORCA_CLI_BIN_DIR && win32.join(process.env.ORCA_CLI_BIN_DIR, 'orca.exe'),
    win32.join(win32.dirname(execPath), 'resources', 'bin', 'orca.exe')
  ]
  return candidates.find((path): path is string => Boolean(path) && exists(path!)) ?? 'orca'
}

async function orcaCli(args: string[], runner: Runner): Promise<any> {
  const result = await runner(orcaBinary(), [...args, '--json'], 30_000)
  let parsed: any = null
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    // reported below
  }
  if (parsed?.ok) return parsed.result
  throw new Error(parsed?.error?.message ?? (result.stderr || 'orca CLI failed').trim())
}

const distros = new Map<string, string>()

/**
 * The workspaces of Orca's WSL environments, with Windows paths. `workspace.list` leaves them out:
 * a plain `orca worktree list` names them in hostScope.omittedHostSelectors as `--environment …`.
 */
export async function listWslWorkspaces(runner: Runner = run): Promise<WslWorkspace[]> {
  const first = await orcaCli(['worktree', 'list'], runner)
  const selectors = [
    ...new Set<string>(
      (first?.hostScope?.omittedHostSelectors ?? [])
        .map((s: { selector?: unknown }) => s?.selector)
        .filter((s: unknown): s is string => typeof s === 'string' && /^--environment\s+\S+$/.test(s.trim()))
    )
  ]
  const lists = await Promise.all(
    selectors.map(async (selector) => {
      try {
        const [flag, value] = selector.trim().split(/\s+/)
        const rows = ((await orcaCli(['worktree', 'list', flag, value], runner))?.worktrees ?? []) as CliWorktree[]
        const linux = rows.filter((row) => typeof row.path === 'string' && row.path.startsWith('/') && typeof row.id === 'string')
        if (!linux.length) return []
        let distro = distros.get(selector)
        if (!distro) {
          distro = (await findDistro(linux.map((row) => row.path!), runner)) ?? undefined
          if (!distro) return [] // Not a WSL distro on this machine.
          distros.set(selector, distro)
        }
        return linux.map((row) => ({
          id: row.id!,
          name: row.displayName || posix.basename(row.path!),
          path: toWslPath(distro!, row.path!),
          branch: row.branch ?? null,
          hostId: row.hostId ?? 'wsl'
        }))
      } catch {
        return [] // That environment is down: the rest still shows.
      }
    })
  )
  return lists.flat()
}
