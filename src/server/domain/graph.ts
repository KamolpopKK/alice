/**
 * Returns true when adding the directed edge `from → to` would close a cycle, i.e. when `from`
 * is already reachable from `to`. `next(id)` lists the existing outgoing edges of a node.
 * Self-edges count as cycles. Iterative DFS with a visited set, so large graphs are safe.
 */
export function wouldCreateCycle(from: string, to: string, next: (id: string) => string[]): boolean {
  if (from === to) return true
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const n of next(id)) if (!seen.has(n)) stack.push(n)
  }
  return false
}
