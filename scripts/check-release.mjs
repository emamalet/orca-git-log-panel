#!/usr/bin/env node
// Release rule for main: every change bumps the version and documents it in CHANGELOG.md.
// Usage: node scripts/check-release.mjs [<base-ref>]   (default base: origin/main)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const parse = (v) => v.split('.').map(Number)
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const errors = []
const manifest = JSON.parse(readFileSync('orca-plugin.json', 'utf8')).version
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version
const top = readFileSync('CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}\r?\n\r?\n\S/m)

if (!/^\d+\.\d+\.\d+$/.test(manifest)) errors.push(`orca-plugin.json version "${manifest}" is not X.Y.Z`)
if (manifest !== pkg) errors.push(`orca-plugin.json (${manifest}) and package.json (${pkg}) versions differ`)
if (!top) errors.push('CHANGELOG.md must have a "## X.Y.Z — YYYY-MM-DD" heading followed by a paragraph')
else if (top[1] !== manifest) errors.push(`latest CHANGELOG.md entry is ${top[1]}, expected ${manifest}`)

const base = process.argv[2] ?? 'origin/main'
let previous = null
try {
  previous = JSON.parse(git('show', `${base}:orca-plugin.json`)).version
} catch {
  console.log(`(base "${base}" not found: skipping the comparison with the previous version)`)
}
if (previous) {
  if (!newer(manifest, previous)) errors.push(`version ${manifest} must be greater than ${previous} (from ${base})`)
  try {
    git('diff', '--quiet', base, '--', 'CHANGELOG.md')
    errors.push(`CHANGELOG.md is unchanged since ${base}`)
  } catch {
    // git diff --quiet exits 1 when the file changed.
  }
}

if (errors.length) {
  console.error(`Release check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  console.error('\nSee CONTRIBUTING.md, section "Versions, changelog and tags".')
  process.exit(1)
}
console.log(`Release check OK: ${manifest} (tag v${manifest} is created automatically once on main)`)
