// Multiplayer Server: the only writer of the economy. Clients send intents; everything is validated here.
// Saves progress per wallet in Storage (coins, upgrades, depth, quests, tutorial) and the tunnel tons globally.
import { engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import { clearLine, findPath, nearestWalkable, walkable } from './nav'
import { CONFIG, DEPTH_TABLE, MAX_LEVEL, NAMES, ORE, ORE_TYPES, OreType, upgradeCost } from './config'
import {
  Bandit,
  BIG_BANK_TONS,
  bootsOf,
  capacityOf,
  damageOf,
  fmtTons,
  grabReduction,
  Heartbeat,
  Load,
  loadOf,
  Miner,
  MinerData,
  Pile,
  questGoal,
  questProgress,
  QUESTS,
  questReward,
  room,
  Rooms,
  SeamRock,
  Stamina,
  SYNC_ID,
  tonsOf,
  valueOf,
  World
} from './shared'

const log = (...a: unknown[]) => console.log('[SERVER]', ...a)

// ---------- types ----------

type Face = { ores: OreType[]; hp: number[]; maxHp: number[]; slidingUntil: number }

type Player = {
  address: string
  miner: Entity
  stamina: Entity
  loading: boolean
  nextLoadTry: number
  st: number // real stamina value (component holds a rounded copy)
  lastSpend: number
  tiredUntil: number
  lastSwing: number
  lastGrab: number
  face: Face | null
  loss: { start: number; startLoad: number; lost: number }
  dirty: boolean
  lastSeen: number
  reported: { x: number; z: number; yaw: number; at: number } | null
}

type SaveData = {
  v: number
  coins: number
  pickaxe: number
  cart: number
  boots: number
  depth: number
  tutorialDone: boolean
  q: { round: number; mine: number; bigBank: number; grab: number; banks: number; done: number }
}

const players = new Map<string, Player>()
let worldEntity: Entity
let roomsEntity: Entity
let heartbeatEntity: Entity
const seam: { entity: Entity; respawnAt: number }[] = []
const piles = new Map<number, Entity>()
let pileCounter = 0
const bandits = new Map<number, Entity>()
let banditCounter = 0
let nextRaidAt = 0
let tunnelDirty = false

// ---------- helpers ----------

function now() {
  return Date.now()
}

function flatDist(a: Vector3, b: Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function scenePos(name: string): Vector3 | null {
  const e = engine.getEntityOrNullByName(name)
  const t = e ? Transform.getOrNull(e) : null
  return t ? Vector3.clone(t.position) : null
}

const playerEntity = new Map<string, Entity>()
const warnedNoTransform = new Set<string>()

function refreshPlayerEntities() {
  playerEntity.clear()
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) playerEntity.set(id.address.toLowerCase(), e)
}

/** Server-verified player transform. If the server has none for that player (seen in local preview),
 *  the player's own recent position report is used instead (logged once), so the safe zone, bandits and
 *  the ram zone keep working; null only when neither exists. */
function playerTransform(address: string): { position: Vector3; rotation: Quaternion } | null {
  const e = playerEntity.get(address)
  const t = e !== undefined ? Transform.getOrNull(e) : null
  if (t) return { position: t.position, rotation: t.rotation }
  if (!warnedNoTransform.has(address)) {
    warnedNoTransform.add(address)
    log(`no Transform for player ${address}: using their position reports`)
  }
  const r = players.get(address)?.reported
  if (r && now() - r.at < 3000) return { position: Vector3.create(r.x, 0, r.z), rotation: Quaternion.fromEulerDegrees(0, r.yaw, 0) }
  return null
}

function playerPos(address: string): Vector3 | null {
  return playerTransform(address)?.position ?? null
}

function cartPos(address: string): Vector3 | null {
  const t = playerTransform(address)
  if (!t) return null
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  const len = Math.hypot(f.x, f.z) || 1
  return Vector3.create(t.position.x + (f.x / len) * CONFIG.cartFrontDistance, 0, t.position.z + (f.z / len) * CONFIG.cartFrontDistance)
}

/** Within `range` of a point; unknown positions pass (logged) so a missing transform never blocks play. */
function near(address: string, point: Vector3 | null, range: number): boolean {
  if (!point) return true
  const p = playerPos(address)
  return !p || flatDist(p, point) <= range
}

let vaultPos: Vector3 | null = null
function inSafeZone(p: Vector3 | null): boolean {
  return !!p && !!vaultPos && flatDist(p, vaultPos) <= CONFIG.safeZoneRadius
}

function notify(address: string, text: string, danger = false) {
  void room.send('notify', { text, danger }, { to: [address] })
}

function bannerAll(text: string) {
  void room.send('banner', { text })
}

function m(p: Player): MinerData {
  return Miner.get(p.miner)
}

function mm(p: Player) {
  return Miner.getMutable(p.miner)
}

function emptyLoad(): Load {
  return { copper: 0, silver: 0, gold: 0, gem: 0 }
}

function setLoad(p: Player, l: Load) {
  const w = mm(p)
  for (const k of ORE_TYPES) w[k] = Math.max(0, Math.round(l[k] * 100) / 100)
}

/** Removes up to `tons` from a load, most valuable ore first. Returns what was removed. */
function takeTons(l: Load, tons: number): Load {
  const out = emptyLoad()
  let left = tons
  for (const k of [...ORE_TYPES].sort((a, b) => ORE[b].value - ORE[a].value)) {
    if (left <= 1e-6) break
    const t = Math.min(l[k], left)
    l[k] -= t
    out[k] += t
    left -= t
  }
  return out
}

/** Adds as much of `add` as fits, most valuable first. Returns the tons added. */
function addTons(p: Player, add: Load): number {
  const l = loadOf(m(p))
  let free = capacityOf(m(p)) - tonsOf(l)
  let added = 0
  for (const k of [...ORE_TYPES].sort((a, b) => ORE[b].value - ORE[a].value)) {
    const t = Math.max(0, Math.min(add[k], free))
    l[k] += t
    free -= t
    added += t
  }
  setLoad(p, l)
  return added
}

function scaleLoad(l: Load, f: number): Load {
  return { copper: l.copper * f, silver: l.silver * f, gold: l.gold * f, gem: l.gem * f }
}

// ---------- persistence ----------

function defaultSave(): SaveData {
  return { v: 1, coins: 0, pickaxe: 1, cart: 1, boots: 1, depth: 0, tutorialDone: false, q: { round: 1, mine: 0, bigBank: 0, grab: 0, banks: 0, done: 0 } }
}

function clampLevel(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 1
  return Math.max(1, Math.min(MAX_LEVEL, v))
}

function num(n: unknown, d = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}

async function loadPlayer(p: Player) {
  p.loading = true
  try {
    let save = await Storage.player.get<SaveData>(p.address, 'save')
    if (save === null) {
      // first visit: create the save once (never on later joins)
      save = defaultSave()
      const ok = await Storage.player.set(p.address, 'save', save)
      if (!ok) log(`could not create save for ${p.address}; will retry on next checkpoint`)
    }
    if (!players.has(p.address) || !Miner.getOrNull(p.miner)) return
    const w = mm(p)
    w.coins = Math.max(0, Math.floor(num(save.coins)))
    w.pickaxe = clampLevel(save.pickaxe)
    w.cart = clampLevel(save.cart)
    w.boots = clampLevel(save.boots)
    w.depth = Math.max(0, Math.floor(num(save.depth)))
    w.tutorialDone = !!save.tutorialDone
    const q = save.q ?? defaultSave().q
    w.qRound = Math.max(1, Math.floor(num(q.round, 1)))
    w.qMine = Math.floor(num(q.mine))
    w.qBigBank = Math.floor(num(q.bigBank))
    w.qGrab = num(q.grab)
    w.qBanks = Math.floor(num(q.banks))
    w.qDone = Math.floor(num(q.done))
    w.loaded = true
    const b = bootsOf(w)
    p.st = b.max
    writeStamina(p, true)
    log(`loaded ${p.address}: ${w.coins} coins, pickaxe ${w.pickaxe}, cart ${w.cart}, boots ${w.boots}, depth ${w.depth}`)
  } catch (e) {
    // a failed read must never fall back to defaults + write (that would wipe progress): retry later
    log(`load failed for ${p.address}, retrying`, e)
    p.nextLoadTry = now() + 5000
  } finally {
    p.loading = false
  }
}

async function savePlayer(p: Player): Promise<boolean> {
  const d = Miner.getOrNull(p.miner)
  if (!d || !d.loaded) return false
  const save: SaveData = {
    v: 1,
    coins: d.coins,
    pickaxe: d.pickaxe,
    cart: d.cart,
    boots: d.boots,
    depth: d.depth,
    tutorialDone: d.tutorialDone,
    q: { round: d.qRound, mine: d.qMine, bigBank: d.qBigBank, grab: d.qGrab, banks: d.qBanks, done: d.qDone }
  }
  try {
    const ok = await Storage.player.set(p.address, 'save', save)
    if (ok) p.dirty = false
    else log(`save not persisted for ${p.address}, will retry`)
    return ok
  } catch (e) {
    log(`save failed for ${p.address}`, e)
    return false
  }
}

function checkpoint(p: Player) {
  p.dirty = true
  void savePlayer(p)
}

async function loadTunnel() {
  try {
    const t = await Storage.get<{ tunnel: number; tons: number }>('tunnel')
    if (t) {
      const w = World.getMutable(worldEntity)
      w.tunnel = Math.max(1, Math.floor(num(t.tunnel, 1)))
      w.tons = Math.max(0, num(t.tons))
    }
  } catch (e) {
    log('tunnel load failed', e)
  }
}

async function saveTunnel() {
  if (!tunnelDirty) return
  const w = World.get(worldEntity)
  try {
    const ok = await Storage.set('tunnel', { tunnel: w.tunnel, tons: w.tons })
    if (ok) tunnelDirty = false
  } catch (e) {
    log('tunnel save failed', e)
  }
}

// ---------- players join / leave ----------

function addPlayer(address: string) {
  const miner = engine.addEntity()
  Miner.create(miner, {
    address,
    name: 'Miner',
    loaded: false,
    coins: 0,
    pickaxe: 1,
    cart: 1,
    boots: 1,
    depth: 0,
    tutorialDone: false,
    hasCart: false,
    copper: 0,
    silver: 0,
    gold: 0,
    gem: 0,
    room: 0,
    roomEndsAt: 0,
    immuneUntil: 0,
    lastRobber: '',
    lastRobberName: '',
    qRound: 1,
    qMine: 0,
    qBigBank: 0,
    qGrab: 0,
    qBanks: 0,
    qDone: 0
  })
  syncEntity(miner, [Miner.componentId])
  const stamina = engine.addEntity()
  Stamina.create(stamina, { address, value: 100, max: 100, tired: false })
  syncEntity(stamina, [Stamina.componentId])
  const p: Player = {
    address,
    miner,
    stamina,
    loading: false,
    nextLoadTry: 0,
    st: 100,
    lastSpend: 0,
    tiredUntil: 0,
    lastSwing: 0,
    lastGrab: 0,
    face: null,
    loss: { start: 0, startLoad: 0, lost: 0 },
    dirty: false,
    lastSeen: now(),
    reported: null
  }
  players.set(address, p)
  log(`joined ${address}`)
  void loadPlayer(p)
}

async function removePlayer(p: Player) {
  players.delete(p.address)
  freeRoomOf(p, '')
  await savePlayer(p)
  engine.removeEntity(p.miner)
  engine.removeEntity(p.stamina)
  log(`left ${p.address} (cart ore lost)`)
}

function presenceSystem() {
  refreshPlayerEntities()
  const t = now()
  for (const address of playerEntity.keys()) {
    const p = players.get(address)
    if (!p) addPlayer(address)
    else {
      p.lastSeen = t
      if (!m(p).loaded && !p.loading && t >= p.nextLoadTry) void loadPlayer(p)
    }
  }
  for (const p of [...players.values()]) if (t - p.lastSeen > 4000) void removePlayer(p)
}

function getPlayer(from: string | undefined): Player | null {
  if (!from) return null
  const p = players.get(from.toLowerCase())
  if (!p || !Miner.getOrNull(p.miner) || !m(p).loaded) return null
  return p
}

// ---------- stamina ----------

function writeStamina(p: Player, force = false) {
  const s = Stamina.getOrNull(p.stamina)
  if (!s) return
  const max = bootsOf(m(p)).max
  const value = Math.round(p.st)
  const tired = now() < p.tiredUntil
  if (force || s.value !== value || s.max !== max || s.tired !== tired) {
    const w = Stamina.getMutable(p.stamina)
    w.value = value
    w.max = max
    w.tired = tired
  }
}

/** Spends stamina for an action, or tells the player they are too tired. */
function spend(p: Player, cost: number): boolean {
  const t = now()
  if (t < p.tiredUntil || p.st < cost) {
    notify(p.address, 'Too tired! Catch your breath.', true)
    return false
  }
  p.st -= cost
  p.lastSpend = t
  if (p.st <= 0.01) {
    p.st = 0
    p.tiredUntil = t + CONFIG.tiredSeconds * 1000
    notify(p.address, 'Too tired! Catch your breath.', true)
  }
  writeStamina(p)
  return true
}

function staminaSystem(dt: number) {
  const t = now()
  for (const p of players.values()) {
    const d = Miner.getOrNull(p.miner)
    if (!d || !d.loaded) continue
    const b = bootsOf(d)
    if (inSafeZone(playerPos(p.address))) {
      p.st = b.max
      p.tiredUntil = 0
    } else if (t - p.lastSpend >= CONFIG.regenDelay * 1000 && t >= p.tiredUntil && p.st < b.max) {
      p.st = Math.min(b.max, p.st + b.regen * dt)
    }
    p.st = Math.min(p.st, b.max)
    writeStamina(p)
  }
}

// ---------- quests ----------

function questCheck(p: Player) {
  const d = m(p)
  const prog = questProgress(d)
  const round = Math.max(1, d.qRound)
  for (let i = 0; i < QUESTS.length; i++) {
    if (d.qDone & (1 << i)) continue
    if (prog[i] >= questGoal(i, round)) {
      const reward = questReward(i, round)
      const w = mm(p)
      w.qDone |= 1 << i
      w.coins += reward
      notify(p.address, `Quest done: ${QUESTS[i].text(questGoal(i, round))}! +${reward} coins`)
      p.dirty = true
    }
  }
  if ((m(p).qDone & 7) === 7) {
    const w = mm(p)
    w.qRound = round + 1
    w.qMine = 0
    w.qBigBank = 0
    w.qGrab = 0
    w.qBanks = 0
    w.qDone = 0
    notify(p.address, `All quests done! Round ${round + 1} quests are up.`)
  }
}

// ---------- claim rooms and the ore face ----------

const roomPads: (Vector3 | null)[] = []

function roomsMutable() {
  return Rooms.getMutable(roomsEntity)
}

function oresForDepth(depth: number): OreType[] {
  let row = DEPTH_TABLE[0]
  for (const r of DEPTH_TABLE) if (depth >= r.from) row = r
  const ores: OreType[] = []
  const entries = Object.entries(row.mix).filter(([, w]) => w > 0) as [OreType, number][]
  const total = entries.reduce((a, [, w]) => a + w, 0)
  for (let i = 0; i < 9; i++) {
    let r = Math.random() * total
    let pick = entries[0][0]
    for (const [k, w] of entries) {
      r -= w
      if (r < 0) {
        pick = k
        break
      }
    }
    ores.push(pick)
  }
  if (row.gem) ores[Math.floor(Math.random() * 9)] = 'gem'
  return ores
}

function newFace(depth: number): Face {
  const ores = oresForDepth(depth)
  const hp = ores.map((o) => ORE[o].hp)
  return { ores, hp: [...hp], maxHp: hp, slidingUntil: 0 }
}

function sendFace(p: Player, event: string, rock: number) {
  const f = p.face
  const d = m(p)
  if (!f || d.room <= 0) return
  void room.send('face', { room: d.room, depth: d.depth, ores: f.ores, hp: f.hp, maxHp: f.maxHp, event, rock }, { to: [p.address] })
}

function freeRoomOf(p: Player, reason: string) {
  const d = Miner.getOrNull(p.miner)
  if (!d || d.room <= 0) return
  // hauling a loaded cart out of the tunnel brings the bandits (if no raid is on and none just ended)
  if (CONFIG.raidOnHaul && reason && tonsOf(loadOf(d)) >= CONFIG.rookieTons && !World.get(worldEntity).raidActive && now() - lastRaidEnd > CONFIG.raidHaulCooldown * 1000) {
    nextRaidAt = Math.min(nextRaidAt, now() + CONFIG.raidHaulDelay * 1000)
  }
  const i = d.room - 1
  const r = roomsMutable()
  r.owners[i] = ''
  r.names[i] = ''
  r.endsAt[i] = 0
  const w = mm(p)
  w.room = 0
  w.roomEndsAt = 0
  p.face = null
  if (reason) void room.send('roomEnded', { reason }, { to: [p.address] })
}

function allRoomsFull(): boolean {
  return Rooms.get(roomsEntity).owners.every((o) => o !== '')
}

function roomTimerSystem() {
  const t = now()
  for (const p of players.values()) {
    const d = Miner.getOrNull(p.miner)
    if (d && d.room > 0 && d.roomEndsAt > 0 && t >= d.roomEndsAt) {
      notify(p.address, "Time's up! Your claim has ended.", true)
      freeRoomOf(p, 'time')
    }
  }
  // owners who are gone
  const r = Rooms.get(roomsEntity)
  r.owners.forEach((o, i) => {
    if (o && !players.has(o)) {
      const w = roomsMutable()
      w.owners[i] = ''
      w.names[i] = ''
      w.endsAt[i] = 0
    }
  })
}

// ---------- open seam (shared, robbable) ----------

function seamOre(): OreType {
  return Math.random() < 0.7 ? 'copper' : 'silver'
}

function setupSeam() {
  for (let i = 0; i < 9; i++) {
    const e = engine.addEntity()
    const gx = (i % 3) - 1
    const gz = Math.floor(i / 3) - 1
    Transform.create(e, { position: Vector3.create(CONFIG.seamOrigin.x + gx * CONFIG.seamSpacing, 0, CONFIG.seamOrigin.z + gz * CONFIG.seamSpacing) })
    const ore = seamOre()
    SeamRock.create(e, { index: i, ore, hp: ORE[ore].hp, maxHp: ORE[ore].hp, alive: true })
    syncEntity(e, [Transform.componentId, SeamRock.componentId])
    seam.push({ entity: e, respawnAt: 0 })
  }
}

function seamRespawnSystem() {
  const t = now()
  for (const s of seam) {
    const r = SeamRock.get(s.entity)
    if (!r.alive && t >= s.respawnAt) {
      const ore = seamOre()
      const w = SeamRock.getMutable(s.entity)
      w.ore = ore
      w.hp = ORE[ore].hp
      w.maxHp = ORE[ore].hp
      w.alive = true
    }
  }
}

// ---------- mining ----------

function onHit(p: Player, rock: number) {
  const d = m(p)
  const t = now()
  if (t - p.lastSwing < CONFIG.swingCooldown * 1000 - 200) return
  if (!d.hasCart) return notify(p.address, 'Take a cart from the dock first!', true)

  let ore: OreType
  let hp: number
  if (rock >= 100) {
    // open seam
    const s = seam[rock - 100]
    if (!s || d.room > 0) return
    const r = SeamRock.get(s.entity)
    if (!r.alive) return
    if (CONFIG.seamOnlyWhenFull && !allRoomsFull()) return notify(p.address, 'Claim a room in Tunnel 1. The open seam is for when all rooms are full.')
    if (!near(p.address, Transform.get(s.entity).position, CONFIG.mineReach + 1.5)) return
    ore = r.ore as OreType
    hp = r.hp
  } else {
    const f = p.face
    if (d.room <= 0 || !f) return
    // -1 = "hit the face": the first standing rock this pickaxe can break (same rule as the client)
    if (rock < 0) {
      rock = f.hp.findIndex((h, i) => h > 0 && d.pickaxe >= ORE[f.ores[i]].needs)
      if (rock < 0) {
        const locked = f.hp.findIndex((h) => h > 0)
        if (locked >= 0) notify(p.address, `Needs Pickaxe Lv${ORE[f.ores[locked]].needs} — see Ironjaw`, true)
        return
      }
    }
    if (rock > 8) return
    if (t < f.slidingUntil) return
    if (!near(p.address, roomPads[d.room - 1], 22)) return notify(p.address, 'You are not in your room.', true)
    if (f.hp[rock] <= 0) return
    ore = f.ores[rock]
    hp = f.hp[rock]
  }

  if (d.pickaxe < ORE[ore].needs) return notify(p.address, `Needs Pickaxe Lv${ORE[ore].needs} — see Ironjaw`, true)
  const free = capacityOf(d) - tonsOf(loadOf(d))
  if (free <= 0.01) return notify(p.address, 'Cart full! Bank it at the vault.', true)
  if (!spend(p, CONFIG.staminaHit)) return
  p.lastSwing = t
  void room.send('swing', { ok: true }, { to: [p.address] })

  hp = Math.max(0, hp - damageOf(d))
  const burst = hp <= 0
  if (burst) {
    const add = emptyLoad()
    add[ore] = ORE[ore].tons
    const got = addTons(p, add)
    mm(p).qMine += 1
    if (got < ORE[ore].tons - 0.01) notify(p.address, 'Cart full! Bank it at the vault.', true)
    questCheck(p)
  }

  if (rock >= 100) {
    const s = seam[rock - 100]
    const w = SeamRock.getMutable(s.entity)
    w.hp = hp
    if (burst) {
      w.alive = false
      s.respawnAt = t + ORE[ore].respawn * 1000
    }
    return
  }

  const f = p.face!
  f.hp[rock] = hp
  if (f.hp.every((h) => h <= 0)) {
    // face cleared: it slides back and a new one appears 10 m deeper
    const w = mm(p)
    w.depth += CONFIG.faceDepth
    p.face = newFace(w.depth)
    p.face.slidingUntil = t + CONFIG.faceSlideSeconds * 1000
    sendFace(p, 'slide', rock)
    checkpoint(p)
  } else sendFace(p, burst ? 'burst' : 'hit', rock)
}

// ---------- stealing ----------

function victimChecks(p: Player, v: Player | null, range: number, quiet = false): Player | null {
  // quiet: a bump (collision) steal that fails stays silent, so running into carts never spams messages
  const say = (text: string, danger = false) => {
    if (!quiet) say(text, danger)
  }
  if (!v || v === p) return null
  const d = m(p)
  const vd = m(v)
  if (!d.hasCart) {
    say('You need a cart to carry stolen ore.', true)
    return null
  }
  if (d.room > 0 || vd.room > 0 || !vd.hasCart) return null
  const pp = playerPos(p.address)
  const vp = cartPos(v.address) ?? playerPos(v.address)
  if (pp && vp && flatDist(pp, vp) > range + CONFIG.stealLagAllowance) {
    say('Get right up to their cart!')
    return null
  }
  if (inSafeZone(pp) || inSafeZone(playerPos(v.address))) {
    say('Safe zone — no stealing here.', true)
    return null
  }
  if (tonsOf(loadOf(vd)) < CONFIG.rookieTons) {
    say(`Not worth it — cart under ${CONFIG.rookieTons} t.`)
    return null
  }
  if (now() < vd.immuneUntil) {
    say(`${vd.name} is shaken — safe for a moment.`)
    return null
  }
  return v
}

function giveImmunity(v: Player) {
  mm(v).immuneUntil = now() + CONFIG.immunitySeconds * 1000
  notify(v.address, `Shaken — safe for ${CONFIG.immunitySeconds} s.`)
}

function onGrab(p: Player, victim: string, bump = false) {
  const t = now()
  if (t - p.lastGrab < CONFIG.grabCooldown * 1000 - 100) return
  const v = victimChecks(p, players.get(victim.toLowerCase()) ?? null, bump ? CONFIG.playerTouchServer : CONFIG.grabRange, bump)
  if (!v) return
  const d = m(p)
  if (capacityOf(d) - tonsOf(loadOf(d)) <= 0.01) return bump ? undefined : notify(p.address, 'Your cart is full!', true)
  // a victim loses at most 30% of their load per 10 s window
  const vl = loadOf(m(v))
  if (t - v.loss.start > CONFIG.lossWindow * 1000) v.loss = { start: t, startLoad: tonsOf(vl), lost: 0 }
  const allowed = v.loss.startLoad * CONFIG.maxLossFraction - v.loss.lost
  if (allowed <= 0.05) {
    giveImmunity(v)
    return bump ? undefined : notify(p.address, `${m(v).name} is shaken — safe for a moment.`)
  }
  if (bump ? p.st < CONFIG.staminaGrab : false) return // a bump needs the stamina, but fails silently
  if (!spend(p, CONFIG.staminaGrab)) return
  p.lastGrab = t
  const amount = Math.min(CONFIG.grabTons * (1 - grabReduction(m(v))), allowed, tonsOf(vl))
  const taken = takeTons(vl, amount)
  setLoad(v, vl)
  v.loss.lost += amount
  const revenge = m(p).lastRobber === v.address
  const received = addTons(p, revenge ? scaleLoad(taken, 1 + CONFIG.revengeBonus) : taken)
  mm(p).qGrab += received
  mm(v).lastRobber = p.address
  mm(v).lastRobberName = m(p).name
  notify(v.address, bump ? `${m(p).name} crashed into your cart and grabbed ${fmtTons(amount)} t!` : `${m(p).name} is grabbing your ore!`, true)
  notify(p.address, (bump ? 'You crashed into ' + m(v).name + '\x27s cart! ' : '') + (revenge ? `REVENGE! Grabbed ${fmtTons(received)} t (+50%)` : `Grabbed ${fmtTons(received)} t!`))
  if (v.loss.lost >= v.loss.startLoad * CONFIG.maxLossFraction - 0.05) giveImmunity(v)
  questCheck(p)
}

function onRam(p: Player, victim: string) {
  const v = victimChecks(p, players.get(victim.toLowerCase()) ?? null, CONFIG.ramRange)
  if (!v) return
  const vp = playerPos(v.address)
  const pp = playerPos(p.address)
  if ((vp && vp.z < CONFIG.ramMinZ) || (pp && pp.z < CONFIG.ramMinZ)) return notify(p.address, 'Ramming only works in the tunnel yard.')
  if (!spend(p, CONFIG.staminaRam)) return
  const vl = loadOf(m(v))
  const spilled = takeTons(vl, tonsOf(vl) * CONFIG.ramSpill)
  setLoad(v, vl)
  const at = cartPos(v.address) ?? vp ?? pp ?? Vector3.create(CONFIG.seamOrigin.x, 0, CONFIG.seamOrigin.z)
  createPile(Vector3.create(at.x + (Math.random() - 0.5) * 2, 0, at.z + (Math.random() - 0.5) * 2), spilled)
  mm(v).lastRobber = p.address
  mm(v).lastRobberName = m(p).name
  notify(v.address, `RAMMED by ${m(p).name}! Ore spilled!`, true)
  notify(p.address, `RAM! ${fmtTons(tonsOf(spilled))} t spilled. Grab the pile!`)
  giveImmunity(v)
}

function createPile(at: Vector3, load: Load) {
  if (tonsOf(load) <= 0.01) return
  const e = engine.addEntity()
  const id = ++pileCounter
  Transform.create(e, { position: at })
  Pile.create(e, { id, ...load, expiresAt: now() + CONFIG.pileSeconds * 1000 })
  syncEntity(e, [Transform.componentId, Pile.componentId])
  piles.set(id, e)
}

function onCollectPile(p: Player, id: number) {
  const e = piles.get(id)
  if (e === undefined || !Pile.getOrNull(e)) return
  const d = m(p)
  if (!d.hasCart || d.room > 0) return notify(p.address, 'You need a cart to collect ore.', true)
  if (!near(p.address, Transform.get(e).position, CONFIG.pileCollectRange + 1.5)) return notify(p.address, 'Get closer to the pile!')
  const pl = Pile.get(e)
  const pileLoad: Load = { copper: pl.copper, silver: pl.silver, gold: pl.gold, gem: pl.gem }
  const free = capacityOf(d) - tonsOf(loadOf(d))
  if (free <= 0.01) return notify(p.address, 'Your cart is full!', true)
  const taken = takeTons(pileLoad, free)
  const got = addTons(p, taken)
  mm(p).qGrab += got
  notify(p.address, `Collected ${fmtTons(got)} t from the pile!`)
  if (tonsOf(pileLoad) <= 0.01) {
    engine.removeEntity(e)
    piles.delete(id)
  } else {
    const w = Pile.getMutable(e)
    for (const k of ORE_TYPES) w[k] = pileLoad[k]
  }
  questCheck(p)
}

function pileSystem() {
  const t = now()
  for (const [id, e] of piles) {
    const pl = Pile.getOrNull(e)
    if (!pl || t >= pl.expiresAt) {
      engine.removeEntity(e)
      piles.delete(id)
    }
  }
}

// ---------- vault, forge, docks ----------

const storePos: (Vector3 | null)[] = []
const dockPos: (Vector3 | null)[] = []

function onDeposit(p: Player) {
  const d = m(p)
  if (!near(p.address, vaultPos, CONFIG.vaultRadius + 4)) return notify(p.address, 'Walk up to the vault counter first.')
  const l = loadOf(d)
  const tons = tonsOf(l)
  if (tons <= 0.01) return notify(p.address, 'Your cart is empty. Go dig!', true)
  const coins = valueOf(l)
  const w = mm(p)
  w.coins += coins
  setLoad(p, emptyLoad())
  w.qBanks += 1
  if (tons >= BIG_BANK_TONS) w.qBigBank += 1
  notify(p.address, `Weighed and paid: +${coins} coins`)
  void room.send('deposited', { coins, tons }, { to: [p.address] })
  questCheck(p)
  checkpoint(p)

  const world = World.getMutable(worldEntity)
  world.tons += tons
  tunnelDirty = true
  if (world.tons >= world.quota) {
    world.tons -= world.quota
    bannerAll(`${CONFIG.tunnelName} quota reached! Next tunnel: ??? (rotation paused for V0)`)
    void saveTunnel()
  }
}

function onBuy(p: Player, kind: string) {
  if (kind !== 'pickaxe' && kind !== 'cart' && kind !== 'boots') return
  const atShop = storePos.some((s) => s && near(p.address, s, CONFIG.storeRadius + 4)) || near(p.address, vaultPos, CONFIG.vaultRadius + 4)
  if (!atShop) return notify(p.address, 'Visit Ironjaw at the Forge to upgrade.')
  const d = m(p)
  const level = d[kind]
  const cost = upgradeCost(level)
  if (cost === null) return notify(p.address, 'Already at max level!')
  if (d.coins < cost) return notify(p.address, 'Not enough coin. Go dig.', true)
  const w = mm(p)
  w.coins -= cost
  w[kind] = level + 1
  if (kind === 'pickaxe') notify(p.address, level + 1 === 2 ? 'That will crack silver.' : `Better steel, deeper ore. Pickaxe Lv${level + 1}!`)
  if (kind === 'cart') notify(p.address, `Cart Lv${level + 1}: holds ${capacityOf(w)} t`)
  if (kind === 'boots') {
    notify(p.address, `Boots Lv${level + 1}: max stamina ${bootsOf(w).max}`)
    writeStamina(p, true)
  }
  checkpoint(p)
}

function onEquip(p: Player, dock: number) {
  const d = m(p)
  if (d.hasCart || d.room > 0) return
  // dock -1: the HUD "Equip Cart" button (cart appears in front of the player); otherwise a dock cart
  if (dock !== -1) {
    const pos = dockPos[dock] ?? null
    if (dock < 0 || dock >= dockPos.length || !near(p.address, pos, 6)) return
  }
  mm(p).hasCart = true
  notify(p.address, `Cart Lv${d.cart} equipped (${capacityOf(d)} t). It rolls in front of you.`)
}

function onUnequip(p: Player) {
  const d = m(p)
  if (!d.hasCart) return
  if (d.room > 0) return notify(p.address, 'Take your cart out of the mine first!', true)
  if (tonsOf(loadOf(d)) > 0.01) return notify(p.address, 'Deposit your ore at the vault first!', true)
  mm(p).hasCart = false
}

function onClaim(p: Player, r: number) {
  const d = m(p)
  if (d.room > 0) return
  if (!d.hasCart) return notify(p.address, 'Take a cart from the dock first!', true)
  if (r < 1 || r > CONFIG.roomCount || !roomPads[r - 1]) return
  if (!near(p.address, scenePos(NAMES.tunnelPad), CONFIG.claimPadRadius + 4)) return notify(p.address, 'Walk to the Tunnel 1 entrance to claim a room.')
  const rooms = Rooms.get(roomsEntity)
  if (rooms.owners[r - 1]) {
    if (allRoomsFull()) return notify(p.address, 'All rooms are taken — mine the open seam in the yard!', true)
    return notify(p.address, `Room ${r} is taken by ${rooms.names[r - 1]}.`, true)
  }
  const ends = now() + CONFIG.roomSeconds * 1000
  const w = roomsMutable()
  w.owners[r - 1] = p.address
  w.names[r - 1] = d.name
  w.endsAt[r - 1] = ends
  const mw = mm(p)
  mw.room = r
  mw.roomEndsAt = ends
  p.face = newFace(d.depth)
  void room.send('roomGranted', { room: r }, { to: [p.address] })
  sendFace(p, 'new', -1)
}

// ---------- bandits ----------
// Bandits walk the open ground of the walkable map (nav.ts): they path around mountains, walls and buildings.
// Raids come from Bandit Spawn1 (west) and Bandit Spawn3 (east); Bandit Spawn2 (the Narrow Pass) hides an ambush.
// More haulers outside = more bandits, and bandits spread out between the carts. A touch reported by the victim's
// client tackles (knockback + 10% of the ore) and the bandit runs off with it.

type BanditBrain = {
  kind: 'raid' | 'ambush'
  home: { x: number; z: number } // where it prowls when nobody is hauling
  expiresAt: number // ambush bandits give up after a while
  path: { x: number; z: number }[]
  repathAt: number
  pathTarget: { x: number; z: number } | null
  wander: { x: number; z: number } | null
  fleeUntil: number // > 0: running away with the loot
  fleeGoal: { x: number; z: number } | null
}
const brains = new Map<number, BanditBrain>()
let spawnWest: Vector3 | null = null
let spawnEast: Vector3 | null = null
let spawnAmbush: Vector3 | null = null
let nextReinforceAt = 0
let ambushReadyAt = 0

function scheduleRaid(first = false) {
  nextRaidAt = now() + (first ? CONFIG.firstRaidSeconds : CONFIG.raidMinSeconds + Math.random() * (CONFIG.raidMaxSeconds - CONFIG.raidMinSeconds)) * 1000
}

/** Loaded carts outside the safe zone and outside the rooms: what bandits go after. */
function raidTargets(): { p: Player; cart: Vector3 }[] {
  const out: { p: Player; cart: Vector3 }[] = []
  for (const p of players.values()) {
    const d = Miner.getOrNull(p.miner)
    if (!d || !d.hasCart || d.room > 0 || tonsOf(loadOf(d)) < CONFIG.rookieTons) continue
    const c = cartPos(p.address)
    if (!c || inSafeZone(c)) continue
    out.push({ p, cart: c })
  }
  return out
}

/** Raid size: 2 bandits, plus more for every extra player hauling ore outside. */
function raidSize(haulers: number): number {
  return Math.min(CONFIG.banditMax, CONFIG.banditCount + Math.max(0, haulers - 1) * CONFIG.banditsPerExtraHauler)
}

/** A spot beside the cart on one side of its way home (used if a Bandit Spawn entity is missing). */
function sideSpot(c: Vector3, side: number): { x: number; z: number } {
  const home = vaultPos ?? Vector3.create(CONFIG.vaultFallback.x, 0, CONFIG.vaultFallback.z)
  const hx = home.x - c.x
  const hz = home.z - c.z
  const len = Math.hypot(hx, hz) || 1
  const fx = hx / len
  const fz = hz / len
  const px = -fz * side
  const pz = fx * side
  for (const d of [CONFIG.banditSideDistance, CONFIG.banditSideDistance * 0.75, CONFIG.banditSideDistance * 0.5]) {
    const p = { x: c.x + px * d + fx * CONFIG.banditSideAhead, z: c.z + pz * d + fz * CONFIG.banditSideAhead }
    if (walkable(p)) return p
  }
  return nearestWalkable({ x: c.x + px * CONFIG.banditSideDistance * 0.5, z: c.z + pz * CONFIG.banditSideDistance * 0.5 })
}

function spawnBandit(at: { x: number; z: number }, kind: 'raid' | 'ambush', lifeSeconds = 0) {
  const spot = nearestWalkable({ x: at.x + (Math.random() - 0.5) * 3, z: at.z + (Math.random() - 0.5) * 3 })
  const e = engine.addEntity()
  const id = ++banditCounter
  Transform.create(e, { position: Vector3.create(spot.x, 0, spot.z) })
  Bandit.create(e, { id })
  syncEntity(e, [Transform.componentId, Bandit.componentId])
  bandits.set(id, e)
  brains.set(id, {
    kind,
    home: { x: at.x, z: at.z },
    expiresAt: lifeSeconds > 0 ? now() + lifeSeconds * 1000 : 0,
    path: [],
    repathAt: 0,
    pathTarget: null,
    wander: null,
    fleeUntil: 0,
    fleeGoal: null
  })
}

/** West / east raid spawn for the n-th bandit (alternating), or a side spot if the scene has no spawn entity. */
function raidSpawn(n: number, firstWest: boolean, c: Vector3): { x: number; z: number } {
  const west = (n % 2 === 0) === firstWest
  const s = west ? spawnWest : spawnEast
  return s ? { x: s.x, z: s.z } : sideSpot(c, west ? 1 : -1)
}

function startRaid(targets: { p: Player; cart: Vector3 }[]) {
  const firstWest = Math.random() < 0.5
  const n = raidSize(targets.length)
  for (let i = 0; i < n; i++) spawnBandit(raidSpawn(i, firstWest, targets[i % targets.length].cart), 'raid')
  nextReinforceAt = now() + CONFIG.banditReinforceSeconds * 1000
  const w = World.getMutable(worldEntity)
  w.raidActive = true
  w.raidEndsAt = now() + CONFIG.raidSeconds * 1000
  bannerAll('Bandits on your tail! Get loaded carts to the Vault!')
  log(`raid started: ${n} bandits, ${targets.length} hauler(s)`)
}

let lastRaidEnd = 0

function endRaid(text: string) {
  lastRaidEnd = now()
  for (const [id, b] of [...brains]) if (b.kind === 'raid') removeBandit(id)
  const w = World.getMutable(worldEntity)
  w.raidActive = false
  w.raidEndsAt = 0
  if (text) bannerAll(text)
  scheduleRaid()
}

function removeBandit(id: number) {
  const e = bandits.get(id)
  if (e !== undefined) engine.removeEntity(e)
  bandits.delete(id)
  brains.delete(id)
}

/** Next point to walk to: straight at the goal when the way is clear, otherwise along an A* path. */
function steer(b: BanditBrain, me: { x: number; z: number }, goal: { x: number; z: number }, t: number): { x: number; z: number } {
  if (clearLine(me, goal)) {
    b.path = []
    return goal
  }
  const moved = !b.pathTarget || Math.hypot(goal.x - b.pathTarget.x, goal.z - b.pathTarget.z) > 2
  if (b.path.length === 0 || t >= b.repathAt || moved) {
    b.path = findPath(me, goal) ?? []
    b.pathTarget = { x: goal.x, z: goal.z }
    b.repathAt = t + 700
  }
  while (b.path.length > 1 && Math.hypot(b.path[0].x - me.x, b.path[0].z - me.z) < 0.7) b.path.shift()
  return b.path[0] ?? goal
}

/** Moves a bandit toward `to`, never onto blocked ground (slides along obstacles when it can). */
function moveBandit(tr: { position: Vector3; rotation: Quaternion }, to: { x: number; z: number }, speed: number, dt: number) {
  const me = tr.position
  const dx = to.x - me.x
  const dz = to.z - me.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.02) return
  const step = Math.min(dist, speed * dt)
  const nx = me.x + (dx / dist) * step
  const nz = me.z + (dz / dist) * step
  let next: { x: number; z: number } | null = null
  if (walkable({ x: nx, z: nz })) next = { x: nx, z: nz }
  else if (walkable({ x: nx, z: me.z })) next = { x: nx, z: me.z }
  else if (walkable({ x: me.x, z: nz })) next = { x: me.x, z: nz }
  if (next) tr.position = Vector3.create(next.x, 0, next.z)
  tr.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
}

function activeCount(kind?: 'raid' | 'ambush'): number {
  let n = 0
  for (const b of brains.values()) if (b.fleeUntil === 0 && (!kind || b.kind === kind)) n++
  return n
}

function banditSystem(dt: number) {
  const world = World.get(worldEntity)
  const t = now()
  const targets = raidTargets()

  // ---- raids (west + east spawns) ----
  if (!world.raidActive) {
    if (t >= nextRaidAt && targets.length > 0) startRaid(targets) // waits until someone is hauling ore outside
  } else if (t >= world.raidEndsAt || activeCount('raid') === 0) {
    endRaid('The bandits are gone... for now.')
  } else if (targets.length > 0 && activeCount('raid') < raidSize(targets.length) && t >= nextReinforceAt) {
    // more haulers outside = more bandits: one joins at a time
    nextReinforceAt = t + CONFIG.banditReinforceSeconds * 1000
    spawnBandit(raidSpawn(activeCount('raid'), Math.random() < 0.5, targets[0].cart), 'raid')
    for (const tg of targets) notify(tg.p.address, 'More bandits are coming!', true)
  }

  // ---- ambush at the Narrow Pass (Bandit Spawn2) ----
  if (spawnAmbush && t >= ambushReadyAt && activeCount('ambush') === 0) {
    const near = targets.filter((tg) => flatDist(tg.cart, spawnAmbush!) <= CONFIG.ambushRadius)
    if (near.length > 0) {
      for (let i = 0; i < CONFIG.ambushCount; i++) spawnBandit({ x: spawnAmbush.x, z: spawnAmbush.z }, 'ambush', CONFIG.ambushSeconds)
      ambushReadyAt = t + CONFIG.ambushCooldown * 1000
      bannerAll('AMBUSH at the Narrow Pass!')
      log(`ambush: ${CONFIG.ambushCount} bandits`)
    }
  }

  // ---- move every bandit; spread them out between the carts ----
  const chasers = new Map<Player, number>()
  for (const [id, e] of [...bandits]) {
    const b = brains.get(id)
    if (!b) continue
    const tr = Transform.getMutable(e)
    const me = { x: tr.position.x, z: tr.position.z }

    // ambush bandits give up after a while
    if (b.kind === 'ambush' && b.expiresAt > 0 && t >= b.expiresAt && b.fleeUntil === 0) {
      b.fleeUntil = t + CONFIG.banditFleeSeconds * 1000
      b.fleeGoal = nearestWalkable(b.home)
      b.path = []
    }

    // running off (with the loot, or giving up)
    if (b.fleeUntil > 0) {
      if (t >= b.fleeUntil || (b.fleeGoal && Math.hypot(b.fleeGoal.x - me.x, b.fleeGoal.z - me.z) < 1)) {
        removeBandit(id)
        continue
      }
      if (b.fleeGoal) moveBandit(tr, steer(b, me, b.fleeGoal, t), CONFIG.banditSpeed * 1.2, dt)
      continue
    }

    // nearest cart, but carts already chased by others count as further away: the bandits spread out
    let best: { p: Player; cart: Vector3 } | null = null
    let bestScore = Infinity
    for (const tg of targets) {
      const score = Math.hypot(me.x - tg.cart.x, me.z - tg.cart.z) + (chasers.get(tg.p) ?? 0) * CONFIG.banditSpreadPenalty
      if (score < bestScore) {
        bestScore = score
        best = tg
      }
    }

    if (best) {
      chasers.set(best.p, (chasers.get(best.p) ?? 0) + 1)
      const side = (id % 2 === 0 ? 1 : -1) * 0.4
      const goal = nearestWalkable({ x: best.cart.x + side, z: best.cart.z })
      moveBandit(tr, steer(b, me, goal, t), CONFIG.banditSpeed, dt)
      // the steal happens only when the victim's own client reports the touch (onBanditContact)
    } else {
      // nobody to chase: prowl around its spawn point
      if (!b.wander || Math.hypot(b.wander.x - me.x, b.wander.z - me.z) < 1) {
        b.wander = nearestWalkable({ x: b.home.x + (Math.random() - 0.5) * 12, z: b.home.z + (Math.random() - 0.5) * 12 })
      }
      moveBandit(tr, steer(b, me, b.wander, t), CONFIG.banditSpeed * 0.4, dt)
    }
  }
}

/** The victim's client saw a bandit touch its cart: check it is plausible, then TACKLE. */
function onBanditContact(p: Player, id: number) {
  const e = bandits.get(id)
  const b = brains.get(id)
  if (e === undefined || !b || b.fleeUntil > 0) return
  const d = m(p)
  if (!d.hasCart || d.room > 0 || tonsOf(loadOf(d)) < CONFIG.rookieTons) return
  const me = Transform.get(e).position
  const c = cartPos(p.address)
  const pp = playerPos(p.address)
  if (c && inSafeZone(c)) return
  const reach = Math.min(c ? flatDist(me, c) : Infinity, pp ? flatDist(me, pp) : Infinity)
  if (reach !== Infinity && reach > CONFIG.banditServerTouch) return // not plausible from here
  // TACKLE: knockback for the player, 10% of the ore gone, and the bandit runs off with it
  const vl = loadOf(d)
  const stolen = takeTons(vl, tonsOf(vl) * CONFIG.banditSteal)
  setLoad(p, vl)
  void room.send('tackle', { x: me.x, z: me.z }, { to: [p.address] })
  notify(p.address, `TACKLED by a bandit! It stole ${fmtTons(tonsOf(stolen))} t of your ore!`, true)
  const from = c ?? pp ?? me
  const away = { x: me.x - (from.x - me.x) * 8, z: me.z - (from.z - me.z) * 8 }
  b.fleeGoal = nearestWalkable(walkable(away) ? away : { x: CONFIG.banditSpawn.x, z: CONFIG.banditSpawn.z })
  b.fleeUntil = now() + CONFIG.banditFleeSeconds * 1000
  b.path = []
}

function onScare(p: Player, id: number) {
  const e = bandits.get(id)
  if (e === undefined) return
  if (!near(p.address, Transform.get(e).position, CONFIG.banditScareRange + 2)) return notify(p.address, 'Get closer to scare it!')
  if (!spend(p, CONFIG.staminaScare)) return
  removeBandit(id)
  notify(p.address, 'You scared the bandit off!')
}

// ---------- init ----------

function guard<T>(name: string, fn: (data: T, p: Player) => void) {
  return (data: T, ctx?: { from: string }) => {
    try {
      const p = getPlayer(ctx?.from)
      if (p) fn(data, p)
    } catch (e) {
      log(`error in ${name}`, e)
    }
  }
}

export function initServer() {
  log('starting')
  // drop entities left in the CRDT snapshot by a previous server run (they are rebuilt below)
  for (const c of [Miner, Stamina, Pile, Bandit, SeamRock]) {
    for (const [e] of engine.getEntitiesWith(c)) if (((e as number) & 0xffff) >= 512) engine.removeEntity(e)
  }

  vaultPos = scenePos(NAMES.vault) ?? Vector3.create(CONFIG.vaultFallback.x, 0, CONFIG.vaultFallback.z)
  storePos.push(scenePos(NAMES.forge), scenePos(NAMES.cartShop))
  for (const n of NAMES.docks) dockPos.push(scenePos(n))
  for (const n of NAMES.roomPads) roomPads.push(scenePos(n))
  if (!vaultPos) log('Vault entity not found: vault/safe-zone checks are off')
  spawnWest = scenePos(NAMES.banditSpawns[0])
  spawnAmbush = scenePos(NAMES.banditSpawns[1])
  spawnEast = scenePos(NAMES.banditSpawns[2])
  log(`bandit spawns: west ${!!spawnWest}, ambush ${!!spawnAmbush}, east ${!!spawnEast}`)

  worldEntity = engine.addEntity()
  World.create(worldEntity, { tunnel: 1, tons: 0, quota: CONFIG.tunnelQuota, raidActive: false, raidEndsAt: 0 })
  syncEntity(worldEntity, [World.componentId], SYNC_ID.world)

  heartbeatEntity = engine.addEntity()
  Heartbeat.create(heartbeatEntity, { at: now() })
  syncEntity(heartbeatEntity, [Heartbeat.componentId], SYNC_ID.heartbeat)

  roomsEntity = engine.addEntity()
  const n = CONFIG.roomCount
  Rooms.create(roomsEntity, { owners: Array(n).fill(''), names: Array(n).fill(''), endsAt: Array(n).fill(0) })
  syncEntity(roomsEntity, [Rooms.componentId], SYNC_ID.rooms)

  setupSeam()
  void loadTunnel()
  scheduleRaid(true)

  room.onMessage('hello', guard('hello', (d, p) => (mm(p).name = d.name.slice(0, 24) || 'Miner')))
  room.onMessage('equipCart', guard('equipCart', (d, p) => onEquip(p, d.dock)))
  room.onMessage('unequipCart', guard('unequipCart', (_d, p) => onUnequip(p)))
  room.onMessage('claimRoom', guard('claimRoom', (d, p) => onClaim(p, d.room)))
  room.onMessage('leaveRoom', guard('leaveRoom', (_d, p) => freeRoomOf(p, 'exit')))
  room.onMessage('hit', guard('hit', (d, p) => onHit(p, d.rock)))
  room.onMessage('deposit', guard('deposit', (_d, p) => onDeposit(p)))
  room.onMessage('buy', guard('buy', (d, p) => onBuy(p, d.kind)))
  room.onMessage('grab', guard('grab', (d, p) => onGrab(p, d.victim)))
  room.onMessage('ram', guard('ram', (d, p) => onRam(p, d.victim)))
  room.onMessage('collectPile', guard('collectPile', (d, p) => onCollectPile(p, d.id)))
  room.onMessage('pos', (d, ctx) => {
    if (!ctx) return
    const p = players.get(ctx.from.toLowerCase())
    if (p && Number.isFinite(d.x) && Number.isFinite(d.z) && Number.isFinite(d.yaw)) p.reported = { x: d.x, z: d.z, yaw: d.yaw, at: now() }
  })
  // victim's client saw a rival run into its cart: the rival grabs (all rules checked, failures stay silent)
  room.onMessage('playerContact', guard('playerContact', (d, p) => {
    const thief = players.get(d.thief.toLowerCase())
    if (thief && thief !== p && Miner.getOrNull(thief.miner)?.loaded) onGrab(thief, p.address, true)
  }))
  room.onMessage('banditContact', guard('banditContact', (d, p) => onBanditContact(p, d.id)))
  room.onMessage('scareBandit', guard('scareBandit', (d, p) => onScare(p, d.id)))
  room.onMessage(
    'tutorialDone',
    guard('tutorialDone', (_d, p) => {
      if (!m(p).tutorialDone) {
        mm(p).tutorialDone = true
        checkpoint(p)
      }
    })
  )

  let slow = 0
  let beat = 0
  let flush = 0
  let tick = 0
  engine.addSystem((dt) => {
    try {
      tick += dt
      if (tick >= 0.1) {
        banditSystem(tick)
        tick = 0
      }
      slow += dt
      if (slow >= 0.25) {
        presenceSystem()
        staminaSystem(slow)
        roomTimerSystem()
        seamRespawnSystem()
        pileSystem()
        slow = 0
      }
      beat += dt
      if (beat >= 2) {
        beat = 0
        Heartbeat.getMutable(heartbeatEntity).at = now()
      }
      flush += dt
      if (flush >= CONFIG.saveEverySeconds) {
        flush = 0
        for (const p of players.values()) if (p.dirty) void savePlayer(p)
        void saveTunnel()
      }
    } catch (e) {
      log('system error', e)
    }
  })
  log('ready')
}
