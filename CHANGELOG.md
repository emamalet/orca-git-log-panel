# Changelog

## 0.3.0 — 2026-11-16

The toolbar now shows the current branch with how far it is behind and ahead of its upstream, and any
rebase or merge in progress; new Fetch and Push buttons fetch every remote and push the current branch,
with a dialog that lists the commits to send, lets you choose the remote and remote branch (publishing a
new branch sets its upstream) and asks before a force push with lease. Right-clicking a branch can now
merge it into the current branch, rebase the current branch onto it, rename it or delete it (asking
again before deleting unmerged work). Checking out with uncommitted changes offers to stash them first.
Selecting several commits lists every file they change, and opening one shows the combined diff. Branch
names with slashes are grouped in folders, and opening a repository selects its HEAD commit.
## 0.2.0 — 2026-11-16

The branches tree is easier to use: a single click now shows only that branch's commits (click it again,
or Show all, to see every branch; Ctrl+click shows several), and a double-click or the locate button that
appears on hover jumps to its latest commit. The shown branches are clearly highlighted with a filter
mark, rows react on hover, and a line above the tree says which branches are shown. The Open in editor tab
button now sits to the right of Show details.

## 0.1.10 — 2026-11-16

No change to the panel itself: the project now has contribution guidelines (CONTRIBUTING.md, plus
AGENTS.md / CLAUDE.md for AI assistants) and a GitHub Action that requires every change to main to bump
the version and add a changelog entry, then tags and publishes the release automatically.

## 0.1.9 — 2026-11-16

Fixed the panel freezing (Orca reporting that Git Log stopped responding) when clicking or double-clicking
a branch in the branches tree. Jumping to a branch tip that was not loaded yet could spin forever while
another page or a branch filter was loading; it now waits for that load and gives up cleanly when the log
is reloaded, so double-clicking a branch reliably shows its log.

## 0.1.8 — 2026-11-16

The changed files of a commit now show as a folder tree: folders fold and unfold, chains of single-child
folders are joined on one line (`src/main/java/...`), each folder shows its file count, and Expand all /
Collapse all buttons sit next to the title; folded folders stay folded while you move between commits.
Double-clicking a changed file now opens its diff in its own Orca editor tab, one per file and commit,
with the same side-by-side / unified views and file navigation (Orca plugins cannot open separate
windows; the in-panel viewer remains as a fallback when no tab can open). The sidebar icon is now a Git
branch.

## 0.1.7 — 2026-11-10

WSL workspaces opened from Windows (`\\wsl.localhost\...`) now work: Git for Windows no longer refuses
them as "dubious ownership", since the plugin trusts those repositories for its own Git commands only.
Terminal titles showing WSL paths (`/home/me/repo` or `~/repo`) now identify the focused workspace, so
same-named workspaces are no longer reported as ambiguous, and the workspace picker shows clean paths.

## 0.1.6 — 2026-11-09

New cover image for the plugin page and the README, showing the plugin title and logo next to the
commit graph and its right-click menu.

## 0.1.5 — 2026-11-06

Adds **Create Patch…** to the commit menu: exports the selected commits with `git format-patch`, oldest
first, to a file or the clipboard. Every context-menu entry now has an icon, and the sidebar panel got
its own icon instead of reusing Source Control's.

## 0.1.4 — 2026-11-06

Adds a diff viewer: double-click (or press Enter on) a changed file in the details pane to see its
changes against the first parent, side by side or unified, with changed words highlighted, a Whole file
toggle, F7 / Shift+F7 to jump between changes and Alt+↑ / Alt+↓ to move between files. Also adds the
plugin icon, a cover image and refreshed screenshots.

## 0.1.3 — 2026-11-03

Screenshots of the log, the interactive rebase dialog and the light theme for the plugin page and the
README, with more neutral wording throughout.

## 0.1.2 — 2026-11-03

The panel now uses Orca's card surface as its background, matching Orca's own panels and tabs instead of
the darker app canvas.

## 0.1.1 — 2026-11-03

History rewriting is disabled, with the reason shown, for commits that cannot be rebased: commits brought
in by merges or older than a merge on HEAD's first-parent history. Previously these actions failed only
after being clicked (for example "commit is not part of the current branch").

## 0.1.0 — 2026-11-03

First release: a Git log in a sidebar panel and in an editor tab, with a coloured commit graph, branch and
tag labels, filters (text or hash, branch, user, date, paths), a Local / Remote / Tags branch tree and a
details pane. Multi-select commits and use the right-click menu to squash, fixup, drop, reword or
interactively rebase them, undo the last commit, check out, create branches and tags, cherry-pick, revert
or reset, with a warning before rewriting pushed commits and an Undo banner after each rewrite.
