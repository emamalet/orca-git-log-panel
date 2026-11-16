# Contributing

Thanks for helping! Whether you write the change yourself or with an AI assistant (Copilot, Claude,
Codex, Cursor…), the same rules apply. AI assistants find them in [AGENTS.md](AGENTS.md).

## Workflow

1. Fork the repository (or create a branch) and open a pull request against `main`.
2. Keep the plugin dependency-free: TypeScript is transpiled by Orca, there is no build step.
3. Before pushing, run:

   ```sh
   orca plugin validate .
   orca plugin test .
   node scripts/check-release.mjs
   ```

## Versions, changelog and tags

Orca installs the latest `vX.Y.Z` tag, so **every change merged into `main` is a release**. The
`Release` GitHub Action enforces it on each pull request and each push to `main`:

1. **Bump the version** in both `orca-plugin.json` and `package.json` (same value, greater than the
   one on `main`): patch for fixes, minor for new features, major for breaking changes.
2. **Add an entry at the top of `CHANGELOG.md`**, in English, one paragraph written for users:

   ```md
   ## 0.2.0 — 2026-12-01

   What changed and why it matters to someone using the panel.
   ```

3. **Do not create the tag yourself**: once the change is on `main`, the action creates the
   `vX.Y.Z` tag and the GitHub release (with the changelog paragraph as notes).

If two pull requests target the same version, the second one must be rebased and bumped again.

## Commits

- Write clear commit messages (imperative mood, e.g. "Fix freeze when clicking a branch").
- Commits produced with an AI assistant should keep its `Co-authored-by:` trailer.
