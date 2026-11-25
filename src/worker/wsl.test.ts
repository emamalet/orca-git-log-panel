import { assert, test } from 'orca/testing'
import { createGit } from './git.ts'
import { listWorkspaces, matchWorkspace, type ListedWorkspace } from './repo.ts'
import {
  childEnv,
  decodeWslOutput,
  findDistro,
  listWslWorkspaces,
  orcaBinary,
  parseWslPath,
  toWslPath,
  windowsEnv,
  type RunResult,
  type Runner
} from './wsl.ts'

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' })

test('WSL paths convert between their Windows and Linux spellings', () => {
  assert.deepEqual(parseWslPath('\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo\\'), {
    share: '\\\\wsl.localhost',
    distro: 'Ubuntu-26.04',
    linuxPath: '/home/me/repo'
  })
  assert.deepEqual(parseWslPath('//wsl$/Ubuntu/'), { share: '\\\\wsl$', distro: 'Ubuntu', linuxPath: '/' })
  assert.equal(parseWslPath('C:\\Users\\me\\repo'), null)
  assert.equal(parseWslPath('/home/me/repo'), null)
  assert.equal(toWslPath('Ubuntu-26.04', '/home/me/repo/'), '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo')
  assert.equal(toWslPath('Ubuntu', '/tmp', '\\\\wsl$'), '\\\\wsl$\\Ubuntu\\tmp')
})

test('on Windows, git for a WSL repository runs inside its distro through wsl.exe', async () => {
  const calls: { file: string; args: string[] }[] = []
  const runner: Runner = async (file, args) => {
    calls.push({ file, args })
    return ok('/home/me/repo\n')
  }
  const root = '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo'
  const git = createGit(root, 'C:\\Git\\cmd\\git.exe', { platform: 'win32', runner })
  assert.equal(await git.out(['rev-parse', '--show-toplevel'], { env: { GIT_EDITOR: ':' } }), '/home/me/repo\n')
  assert.equal(calls[0].file, 'wsl.exe')
  assert.deepEqual(calls[0].args.slice(0, 9), [
    '-d', 'Ubuntu-26.04', '--cd', '/home/me/repo', '--exec', 'env', 'GIT_TERMINAL_PROMPT=0', 'LC_ALL=C', 'GIT_EDITOR=:'
  ])
  assert.deepEqual(calls[0].args.slice(9, 10), ['git'])
  assert.deepEqual(calls[0].args.slice(-2), ['rev-parse', '--show-toplevel'])

  assert.equal(git.fromGit('/home/me/repo/.git/info/exclude'), '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo\\.git\\info\\exclude')
  assert.equal(git.fromGit('.git/info/exclude'), '.git/info/exclude')
  assert.equal(git.toGit('\\\\wsl.localhost\\Ubuntu-26.04\\tmp\\orca-git-log-1\\todo'), '/tmp/orca-git-log-1/todo')
  assert.equal(git.toGit('C:\\Users\\me\\AppData\\Local\\Temp\\todo'), '/mnt/c/Users/me/AppData/Local/Temp/todo')
  assert.equal(git.tempDir(), '\\\\wsl.localhost\\Ubuntu-26.04\\tmp')

  const failing = createGit(root, 'git', { platform: 'win32', runner: async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository\n' }) })
  await assert.rejects(failing.out(['status']), /not a git repository/)
})

test('off Windows, or for a path outside WSL, git runs as before', () => {
  const linux = createGit('//wsl.localhost/Ubuntu/home/me/repo', 'git', { platform: 'linux' })
  assert.equal(linux.fromGit('/home/me/repo'), '/home/me/repo')
  assert.equal(linux.toGit('/tmp/x'), '/tmp/x')
  const local = createGit('C:\\repo', 'git', { platform: 'win32' })
  assert.equal(local.fromGit('C:/repo/.git'), 'C:/repo/.git')
})

test('child processes get the Windows variables Orca leaves out, without Electron node mode', () => {
  const env = windowsEnv({ USERPROFILE: 'C:\\Users\\me', windir: 'C:\\Windows', PATH: 'x' })
  assert.equal(env.APPDATA, 'C:\\Users\\me\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\me\\AppData\\Local')
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(windowsEnv({ USERPROFILE: 'C:\\u', AppData: 'D:\\roaming' }).APPDATA, undefined)
  const child = childEnv({ USERPROFILE: 'C:\\u', ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(child.ELECTRON_RUN_AS_NODE, undefined)
})

test('the orca CLI is the one next to the running app', () => {
  const app = 'C:\\Users\\me\\AppData\\Local\\Programs\\orca\\Orca.exe'
  const cli = 'C:\\Users\\me\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe'
  assert.equal(orcaBinary(app, (p) => p === cli), cli)
  assert.equal(orcaBinary(app, () => false), 'orca')
})

test('wsl.exe output is decoded from UTF-16LE, git output from UTF-8', () => {
  assert.equal(decodeWslOutput(Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')), 'Ubuntu\r\nDebian\r\n')
  assert.equal(decodeWslOutput(Buffer.from('名刺\n', 'utf8')), '名刺\n')
  assert.equal(decodeWslOutput(Buffer.alloc(0)), '')
})

function fakeOrca(): Runner {
  return async (file, args) => {
    if (file === 'wsl.exe' && args[0] === '-l') return ok('Ubuntu-20.04\r\nUbuntu-26.04\r\ndocker-desktop\r\n')
    if (file === 'wsl.exe') return ok(args[1] === 'Ubuntu-26.04' ? 'ORCA\npaths 1\n' : 'paths 1\n')
    if (args.includes('--environment')) {
      return ok(JSON.stringify({ ok: true, result: { worktrees: [{ id: 'r1::/home/me/card', path: '/home/me/card', displayName: 'card', branch: 'refs/heads/main' }] } }))
    }
    return ok(
      JSON.stringify({
        ok: true,
        result: {
          worktrees: [],
          hostScope: {
            omittedHostSelectors: [
              { hostId: 'local', selector: null },
              { hostId: 'runtime:1', selector: '--environment wsl' },
              { hostId: 'ssh:1', selector: null }
            ]
          }
        }
      })
    )
  }
}

test('the distro running Orca wins over another one holding the same paths', async () => {
  assert.equal(await findDistro(['/home/me/card'], fakeOrca()), 'Ubuntu-26.04')
  assert.equal(await findDistro([], async () => ({ code: 1, stdout: '', stderr: 'no WSL' })), null)
})

test('workspaces of the WSL environment are listed with Windows paths', async () => {
  assert.deepEqual(await listWslWorkspaces(fakeOrca()), [
    { id: 'r1::/home/me/card', name: 'card', path: '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\card', branch: 'refs/heads/main', hostId: 'wsl' }
  ])
  assert.deepEqual(await listWslWorkspaces(async () => ({ code: 1, stdout: '', stderr: 'down' })).catch(() => 'failed'), 'failed')
})

test('on Windows the workspace list adds WSL workspaces, elsewhere it is unchanged', async () => {
  const local = { id: 'folder:1', kind: 'folder', name: 'chat', path: 'C:\\chat', branch: null, hostId: null }
  const orca = { host: { call: async () => ({ workspaces: [local], truncated: false }) } } as any
  const wsl = { id: 'r1::/home/me/card', name: 'card', path: '\\\\wsl.localhost\\U\\home\\me\\card', branch: null, hostId: 'wsl' }
  const listWsl = async () => [wsl]
  assert.deepEqual(await listWorkspaces(orca, { platform: 'darwin', listWsl }), [local])
  assert.deepEqual(await listWorkspaces(orca, { platform: 'win32', fresh: true, listWsl }), [local, { ...wsl, wsl: true }])
  const broken = async () => {
    throw new Error('orca CLI failed')
  }
  assert.deepEqual(await listWorkspaces(orca, { platform: 'win32', fresh: true, listWsl: broken }), [local])
})

test('a focused WSL workspace is found by its id, else by its name', () => {
  const card: ListedWorkspace = { id: 'r1::/home/me/card', name: 'card', path: process.cwd(), branch: null, hostId: 'wsl', wsl: true }
  const other: ListedWorkspace = { id: 'r2::/home/me/card', name: 'card', path: process.cwd(), branch: null, hostId: 'wsl', wsl: true }
  const list = [card, other]
  assert.deepEqual(matchWorkspace({ workspaceId: 'r2::/home/me/card', branch: '', displayName: 'card' }, list), { workspace: other })
  assert.deepEqual(matchWorkspace({ branch: '', displayName: 'card' }, [card]), { workspace: card })
})
