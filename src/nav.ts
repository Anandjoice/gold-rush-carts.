// Grid pathfinding for bandits (server side) over the walkable map in navgrid.ts.
// A* on 1 m cells with 8 directions, then the path is shortened wherever there is a clear straight line.
import { NAV } from './navgrid'

type P = { x: number; z: number }

const W = NAV.width
const H = NAV.height
const C = NAV.cell
let grid: Uint8Array | null = null

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decode(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buf = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i])
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buf >> bits) & 0xff
    }
  }
  return out
}

function g(): Uint8Array {
  if (!grid) grid = decode(NAV.bits)
  return grid
}

function cellOf(p: P): P {
  return { x: Math.floor(p.x / C), z: Math.floor(p.z / C) }
}

export function walkableCell(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= W || z >= H) return false
  const i = z * W + x
  return ((g()[i >> 3] >> (i & 7)) & 1) === 0
}

export function walkable(p: P): boolean {
  const c = cellOf(p)
  return walkableCell(c.x, c.z)
}

/** Nearest walkable point to p (spiral search), or p itself if nothing is found nearby. */
export function nearestWalkable(p: P, maxRadius = 12): P {
  const c = cellOf(p)
  if (walkableCell(c.x, c.z)) return p
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (walkableCell(c.x + dx, c.z + dz)) return { x: (c.x + dx + 0.5) * C, z: (c.z + dz + 0.5) * C }
      }
  }
  return p
}

/** True when a straight walk from a to b crosses only walkable cells. */
export function clearLine(a: P, b: P): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.ceil(d / (C * 0.5)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (!walkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false
  }
  return true
}

/** Waypoints (world metres) from `from` to `to` around obstacles, or null if no route exists. */
export function findPath(from: P, to: P, maxNodes = 6000): P[] | null {
  const s = cellOf(nearestWalkable(from))
  const e = cellOf(nearestWalkable(to))
  if (s.x === e.x && s.z === e.z) return [to]
  const start = s.z * W + s.x
  const goal = e.z * W + e.x
  const gScore = new Map<number, number>([[start, 0]])
  const came = new Map<number, number>()
  const closed = new Set<number>()
  // binary heap of [f, index]
  const heap: [number, number][] = []
  const push = (f: number, i: number) => {
    heap.push([f, i])
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heap[p][0] <= heap[k][0]) break
      ;[heap[p], heap[k]] = [heap[k], heap[p]]
      k = p
    }
  }
  const pop = (): [number, number] | undefined => {
    if (heap.length === 0) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        k = m
      }
    }
    return top
  }
  const h = (i: number) => {
    const dx = Math.abs((i % W) - e.x)
    const dz = Math.abs(Math.floor(i / W) - e.z)
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz)
  }
  push(h(start), start)
  let expanded = 0
  while (heap.length > 0) {
    const [, cur] = pop()!
    if (cur === goal) break
    if (closed.has(cur)) continue
    closed.add(cur)
    if (++expanded > maxNodes) return null
    const cx = cur % W
    const cz = Math.floor(cur / W)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue
        const nx = cx + dx
        const nz = cz + dz
        if (!walkableCell(nx, nz)) continue
        // no corner cutting past an obstacle
        if (dx !== 0 && dz !== 0 && (!walkableCell(cx + dx, cz) || !walkableCell(cx, cz + dz))) continue
        const ni = nz * W + nx
        const ng = (gScore.get(cur) ?? 0) + (dx !== 0 && dz !== 0 ? 1.414 : 1)
        if (ng < (gScore.get(ni) ?? Infinity)) {
          gScore.set(ni, ng)
          came.set(ni, cur)
          push(ng + h(ni), ni)
        }
      }
  }
  if (!came.has(goal)) return null
  const cells: P[] = []
  for (let i = goal; i !== start; i = came.get(i)!) cells.push({ x: ((i % W) + 0.5) * C, z: (Math.floor(i / W) + 0.5) * C })
  cells.reverse()
  cells[cells.length - 1] = to
  // shorten: skip ahead to the farthest waypoint still in a clear straight line
  const out: P[] = []
  let cur: P = from
  let i = 0
  while (i < cells.length) {
    let j = cells.length - 1
    while (j > i && !clearLine(cur, cells[j])) j--
    out.push(cells[j])
    cur = cells[j]
    i = j + 1
  }
  return out
}
