// Entry of a diff editor tab: its document names the commit and files to show.
import type { DiffTabRequest } from '../shared/protocol.ts'
import { errorMessage, orca } from './api.ts'
import { openDiff, type DiffMode } from './diff.ts'
import { h } from './dom.ts'
import { bindEditorFont } from './editor-font.ts'

const PREFS_KEY = 'git-log.prefs.diff'

bindEditorFont()

async function start(): Promise<void> {
  let req: DiffTabRequest
  try {
    const doc = await orca.document!.get()
    req = JSON.parse(doc.content.text ?? '')
    if (!req?.root || !req.hash || !Array.isArray(req.files) || !req.files.length) throw new Error('This diff file is incomplete.')
  } catch (error) {
    document.body.append(h('div', { class: 'diff-note error' }, `Cannot show this diff: ${errorMessage(error)}`))
    return
  }
  let prefs: { mode?: DiffMode; wholeFile?: boolean } = {}
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    prefs = {}
  }
  openDiff({
    root: req.root,
    hash: req.hash,
    files: req.files,
    index: req.index,
    mode: prefs.mode,
    wholeFile: prefs.wholeFile,
    embedded: true,
    onPrefs: (mode, wholeFile) => localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, wholeFile }))
  })
}

void start()
