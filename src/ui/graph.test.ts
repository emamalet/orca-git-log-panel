import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeGraph, graphSvg } from './graph.ts'
import { reachableFrom, refLabels, relativeDate } from './format.ts'

const row = (hash: string, ...parents: string[]) => ({ hash, parents })

test('a straight history stays in lane 0 with one color', () => {
  const graph = computeGraph([row('c', 'b'), row('b', 'a'), row('a')])
  assert.deepEqual(graph.map((g) => [g.lane, g.color, g.width]), [[0, 0, 1], [0, 0, 1], [0, 0, 1]])
  assert.deepEqual(graph[0].incoming, [])
  assert.deepEqual(graph[1].incoming, [{ lane: 0, color: 0 }])
  assert.deepEqual(graph[2].outgoing, [])
})

test('a merge forks a lane for the second parent and joins it back at the fork point', () => {
  // m merges f (side) into b; both come from a.
  const graph = computeGraph([row('m', 'b', 'f'), row('f', 'a'), row('b', 'a'), row('a')])
  assert.deepEqual(graph[0].outgoing.map((s) => s.lane), [0, 1])
  assert.equal(graph[1].lane, 1)
  assert.deepEqual(graph[1].through.map((s) => s.lane), [0])
  assert.equal(graph[2].lane, 0)
  assert.deepEqual(graph[2].through.map((s) => s.lane), [1])
  assert.equal(graph[3].lane, 0)
  assert.deepEqual(graph[3].incoming.map((s) => s.lane).sort(), [0, 1])
  assert.notEqual(graph[1].color, graph[0].color)
})

test('two branch tips get their own lanes, and freed lanes are reused', () => {
  const graph = computeGraph([row('x', 'a'), row('y', 'a'), row('a', 'r'), row('z', 'r'), row('r')])
  assert.deepEqual(graph.map((g) => g.lane), [0, 1, 0, 1, 0])
  assert.ok(graphSvg(graph[0], { head: true }).includes('class="node head c0"'))
})

test('relative dates', () => {
  const now = new Date(2026, 0, 15, 15, 0).getTime()
  const at = (d: Date) => d.getTime() / 1000
  assert.equal(relativeDate(at(new Date(2026, 0, 15, 14, 59, 40)), now), 'Moments ago')
  assert.equal(relativeDate(at(new Date(2026, 0, 15, 14, 55)), now), '5 minutes ago')
  assert.equal(relativeDate(at(new Date(2026, 0, 15, 13, 30)), now), '1 hour ago')
  assert.equal(relativeDate(at(new Date(2026, 0, 15, 9, 5)), now), 'Today 09:05')
  assert.equal(relativeDate(at(new Date(2026, 0, 14, 22, 1)), now), 'Yesterday 22:01')
})

test('ref labels merge a branch with its remote counterparts', () => {
  const labels = refLabels(['refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/origin/dev', 'refs/tags/v1', 'refs/heads/a'], 'main')
  assert.deepEqual(
    labels.map((l) => [l.kind, l.text, !!l.current]),
    [['local', 'origin & main', true], ['local', 'a', false], ['remote', 'origin/dev', false], ['tag', 'v1', false]]
  )
})

test('reachability follows parents from HEAD', () => {
  const rows = [row('x', 'a'), row('y', 'a'), row('a')].map((r) => ({ ...r, author: '', email: '', authorTime: 0, committer: '', commitTime: 0, subject: '', refs: [] }))
  assert.deepEqual([...reachableFrom('y', rows)].sort(), ['a', 'y'])
})
