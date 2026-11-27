import { orca } from './api.ts'

interface EditorTypography {
  cssFontFamily?: string
  fontFamily?: string
}

function applyEditorFont(typography: EditorTypography | null | undefined): void {
  const family = typography?.cssFontFamily?.trim() || typography?.fontFamily?.trim()
  if (!family) return
  document.documentElement.style.setProperty('--git-log-editor-font-family', family)
}

/** Syncs `--git-log-editor-font-family` with Orca's active editor font setting. */
export function bindEditorFont(): void {
  if (!orca?.host?.has('editor.readTypography')) return

  let revision = 0

  orca.on('editor.typography.changed', (typography: EditorTypography) => {
    revision += 1
    applyEditorFont(typography)
  })

  const initialRevision = revision
  void orca.host
    .call('editor.readTypography')
    .then((typography: EditorTypography) => {
      if (revision === initialRevision) applyEditorFont(typography)
    })
    .catch(() => {})
}
