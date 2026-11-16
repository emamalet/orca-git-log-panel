# Instructions for AI coding agents

Orca plugin (see `orca-plugin.json`): a `trusted-worker` in `src/worker/` runs `git`, the UI in
`src/ui/` is vanilla TypeScript with no build step. Read [CONTRIBUTING.md](CONTRIBUTING.md).

## Mandatory for every change that will reach `main`

CI (`.github/workflows/release.yml`) rejects the change otherwise:

1. Bump `version` in **both** `orca-plugin.json` and `package.json` to the same, greater value
   (patch = fix, minor = feature, major = breaking change).
2. Add a new entry at the **top** of `CHANGELOG.md`: `## X.Y.Z — YYYY-MM-DD`, a blank line, then
   one English paragraph describing the change for users.
3. Do **not** create or push `vX.Y.Z` tags: the workflow tags and releases once on `main`.

## Before finishing

```sh
node scripts/check-release.mjs   # must print "Release check OK"
orca plugin validate .
orca plugin test .
```

Keep the plugin free of runtime dependencies and keep changes focused.
