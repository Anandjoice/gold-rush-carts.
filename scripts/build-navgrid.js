// Builds src/navgrid.ts: a 1 m walkable grid for bandits, from assets/scene/main.composite.
// Every model (GLB, using its real bounds) or box that stands on the ground becomes blocked cells.
// Re-run after moving obstacles in the Creator Hub:   node scripts/build-navgrid.js
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const scene = JSON.parse(fs.readFileSync(path.join(ROOT, 'scene.json'), 'utf8'))
const comp = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/scene/main.composite'), 'utf8'))

// scene size from parcels
let maxPX = 0
let maxPZ = 0
for (const p of scene.scene.parcels) {
  const [x, z] = p.split(',').map(Number)
  maxPX = Math.max(maxPX, x)
  maxPZ = Math.max(maxPZ, z)
}
const W = (maxPX + 1) * 16
const H = (maxPZ + 1) * 16
const CELL = 1
const GW = Math.ceil(W / CELL)
const GH = Math.ceil(H / CELL)

// names that never block (hidden pads, templates, click boxes, things the player walks over)
// Mountain_Archway is the Narrow Pass: its bounding box covers the opening, so it must not block
const SKIP = [/^Bandit Spawn/, /^Mountain_Archway/, /^MineSpawner/, /^Rock_Stroke/, /^Bronze$/, /^Silver$/, /^Gold$/, /^Gem1$/, /^Floor/, /^Plane/]

const data = {}
for (const c of comp.components) data[c.name] = c.data
const get = (name, e) => (data[name] && data[name][e] ? data[name][e].json : null)
const entities = new Set(Object.keys(data['core::Transform'] || {}))

// ---- math ----
function quatToMat(q) {
  const { x, y, z, w } = q
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
  ]
}
// 4x4 column-major-free: we keep {m: 3x3 (rotation*scale), t: vec3}
function trs(t) {
  const p = t.position || { x: 0, y: 0, z: 0 }
  const r = quatToMat(t.rotation || { x: 0, y: 0, z: 0, w: 1 })
  const s = t.scale || { x: 1, y: 1, z: 1 }
  const m = [r[0] * s.x, r[1] * s.y, r[2] * s.z, r[3] * s.x, r[4] * s.y, r[5] * s.z, r[6] * s.x, r[7] * s.y, r[8] * s.z]
  return { m, t: [p.x, p.y, p.z] }
}
function mul(a, b) {
  const m = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = a.m[i * 3] * b.m[j] + a.m[i * 3 + 1] * b.m[3 + j] + a.m[i * 3 + 2] * b.m[6 + j]
  const t = apply(a, b.t)
  return { m, t }
}
function apply(a, v) {
  return [
    a.m[0] * v[0] + a.m[1] * v[1] + a.m[2] * v[2] + a.t[0],
    a.m[3] * v[0] + a.m[4] * v[1] + a.m[5] * v[2] + a.t[1],
    a.m[6] * v[0] + a.m[7] * v[1] + a.m[8] * v[2] + a.t[2]
  ]
}
function worldOf(e, depth = 0) {
  const t = get('core::Transform', e)
  if (!t) return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }
  const local = trs(t)
  if (t.parent !== undefined && t.parent !== 0 && depth < 20 && entities.has(String(t.parent))) return mul(worldOf(String(t.parent), depth + 1), local)
  return local
}

// ---- GLB bounds (mesh accessors through the glTF node hierarchy) ----
const glbCache = {}
function nodeMat(n) {
  if (n.matrix) {
    const a = n.matrix
    return { m: [a[0], a[4], a[8], a[1], a[5], a[9], a[2], a[6], a[10]], t: [a[12], a[13], a[14]] }
  }
  return trs({
    position: n.translation ? { x: n.translation[0], y: n.translation[1], z: n.translation[2] } : undefined,
    rotation: n.rotation ? { x: n.rotation[0], y: n.rotation[1], z: n.rotation[2], w: n.rotation[3] } : undefined,
    scale: n.scale ? { x: n.scale[0], y: n.scale[1], z: n.scale[2] } : undefined
  })
}
function glbBoxes(src) {
  if (glbCache[src] !== undefined) return glbCache[src]
  const file = path.join(ROOT, src)
  if (!fs.existsSync(file)) return (glbCache[src] = null)
  const b = fs.readFileSync(file)
  const len = b.readUInt32LE(12)
  const j = JSON.parse(b.slice(20, 20 + len).toString())
  const boxes = [] // corner sets in model space
  const visit = (ni, parent) => {
    const n = j.nodes[ni]
    const m = parent ? mul(parent, nodeMat(n)) : nodeMat(n)
    if (n.mesh !== undefined) {
      let mn = [Infinity, Infinity, Infinity]
      let mx = [-Infinity, -Infinity, -Infinity]
      for (const p of j.meshes[n.mesh].primitives) {
        const a = j.accessors[p.attributes.POSITION]
        if (!a || !a.min) continue
        for (let i = 0; i < 3; i++) {
          mn[i] = Math.min(mn[i], a.min[i])
          mx[i] = Math.max(mx[i], a.max[i])
        }
      }
      if (mn[0] !== Infinity) boxes.push({ m, mn, mx })
    }
    for (const c of n.children || []) visit(c, m)
  }
  const sceneIdx = j.scene ?? 0
  for (const ni of (j.scenes && j.scenes[sceneIdx] ? j.scenes[sceneIdx].nodes : j.nodes.map((_, i) => i))) visit(ni, null)
  return (glbCache[src] = boxes)
}

// ---- rasterize ----
const blocked = new Uint8Array(GW * GH)
let count = 0
function rasterBox(world, inner, mn, mx) {
  // inner: model-space transform of this box; world: entity world transform
  const full = inner ? mul(world, inner) : world
  const corners = []
  for (const x of [mn[0], mx[0]]) for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) corners.push(apply(full, [x, y, z]))
  const ys = corners.map((c) => c[1])
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (maxY < 0.3 || minY > 1.8 || maxY - minY < 0.3) return false // not a ground-level obstacle
  // invert the 3x3 to test cell centres in box space
  const m = full.m
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (Math.abs(det) < 1e-9) return false
  const inv = [
    (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det
  ]
  const xs = corners.map((c) => c[0])
  const zs = corners.map((c) => c[2])
  const x0 = Math.max(0, Math.floor(Math.min(...xs) / CELL))
  const x1 = Math.min(GW - 1, Math.floor(Math.max(...xs) / CELL))
  const z0 = Math.max(0, Math.floor(Math.min(...zs) / CELL))
  const z1 = Math.min(GH - 1, Math.floor(Math.max(...zs) / CELL))
  const testY = Math.max(minY, Math.min(maxY, 0.8)) // knee/hip height slice
  let any = false
  for (let gz = z0; gz <= z1; gz++)
    for (let gx = x0; gx <= x1; gx++) {
      const wx = (gx + 0.5) * CELL - full.t[0]
      const wy = testY - full.t[1]
      const wz = (gz + 0.5) * CELL - full.t[2]
      const lx = inv[0] * wx + inv[1] * wy + inv[2] * wz
      const ly = inv[3] * wx + inv[4] * wy + inv[5] * wz
      const lz = inv[6] * wx + inv[7] * wy + inv[8] * wz
      const eps = 1e-4
      if (lx >= mn[0] - eps && lx <= mx[0] + eps && ly >= mn[1] - eps && ly <= mx[1] + eps && lz >= mn[2] - eps && lz <= mx[2] + eps) {
        blocked[gz * GW + gx] = 1
        any = true
      }
    }
  return any
}

for (const e of entities) {
  const name = (get('core-schema::Name', e) || {}).value || ''
  if (SKIP.some((r) => r.test(name))) continue
  const world = worldOf(e)
  const gl = get('core::GltfContainer', e)
  const mr = get('core::MeshRenderer', e)
  let hit = false
  if (gl && gl.src) {
    const boxes = glbBoxes(gl.src)
    if (boxes) for (const b of boxes) hit = rasterBox(world, b.m, b.mn, b.mx) || hit
  } else if (mr && mr.mesh && (mr.mesh.$case === 'box' || mr.mesh.$case === 'cylinder')) {
    hit = rasterBox(world, null, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
  }
  if (hit) count++
}

// grow obstacles by one cell so bandits keep clear of edges
const grown = new Uint8Array(blocked)
for (let z = 0; z < GH; z++)
  for (let x = 0; x < GW; x++) {
    if (!blocked[z * GW + x]) continue
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if (nx >= 0 && nz >= 0 && nx < GW && nz < GH) grown[nz * GW + nx] = 1
      }
  }
// scene border is never walkable
for (let x = 0; x < GW; x++) grown[x] = grown[(GH - 1) * GW + x] = 1
for (let z = 0; z < GH; z++) grown[z * GW] = grown[z * GW + GW - 1] = 1

// pack bits -> base64
const bytes = Buffer.alloc(Math.ceil((GW * GH) / 8))
let free = 0
for (let i = 0; i < GW * GH; i++) {
  if (grown[i]) bytes[i >> 3] |= 1 << (i & 7)
  else free++
}
const out = `// GENERATED by scripts/build-navgrid.js from assets/scene/main.composite. Do not edit by hand:
// re-run \`node scripts/build-navgrid.js\` after moving obstacles in the Creator Hub.
// 1 bit per ${CELL} m cell, row-major from (x=0, z=0); 1 = blocked.
export const NAV = { cell: ${CELL}, width: ${GW}, height: ${GH}, bits: '${bytes.toString('base64')}' }
`
fs.writeFileSync(path.join(ROOT, 'src/navgrid.ts'), out)
console.log(`navgrid ${GW}x${GH}: ${count} obstacles, ${free} walkable cells (${Math.round((free / (GW * GH)) * 100)}%)`)

// ASCII preview for a quick sanity check (2 m per char, north at the top)
if (process.argv.includes('--preview')) {
  const rows = []
  for (let z = GH - 2; z >= 0; z -= 2) {
    let r = ''
    for (let x = 0; x < GW; x += 2) r += grown[z * GW + x] ? '#' : '.'
    rows.push(r)
  }
  console.log(rows.join('\n'))
}
