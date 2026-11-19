// Synced components and messages shared by the client and the Multiplayer Server.
// Must be imported statically (index.ts) so everything is defined before the engine seals.
import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer, registerMessages } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { BOOTS, CART_CAPACITY, CART_GRAB_REDUCTION, CONFIG, ORE, ORE_TYPES, OreType, PICKAXE_DAMAGE } from './config'

// ---------- components (written by the server only) ----------

/** One per player in the scene: saved progress + cart load + room + steal state. */
export const Miner = engine.defineComponent('grc::Miner', {
  address: Schemas.String,
  name: Schemas.String,
  loaded: Schemas.Boolean, // save has been read
  coins: Schemas.Int,
  pickaxe: Schemas.Int,
  cart: Schemas.Int,
  boots: Schemas.Int,
  depth: Schemas.Int,
  tutorialDone: Schemas.Boolean,
  hasCart: Schemas.Boolean,
  copper: Schemas.Number,
  silver: Schemas.Number,
  gold: Schemas.Number,
  gem: Schemas.Number,
  room: Schemas.Int, // 1..4 while in a claim room
  roomEndsAt: Schemas.Int64,
  immuneUntil: Schemas.Int64,
  lastRobber: Schemas.String,
  lastRobberName: Schemas.String,
  qRound: Schemas.Int,
  qMine: Schemas.Int,
  qBigBank: Schemas.Int,
  qGrab: Schemas.Number,
  qBanks: Schemas.Int,
  qDone: Schemas.Int // bitmask of finished quests
})
export type MinerData = ReturnType<typeof Miner.get>

/** Kept apart from Miner because it changes several times a second while regenerating. */
export const Stamina = engine.defineComponent('grc::Stamina', {
  address: Schemas.String,
  value: Schemas.Number,
  max: Schemas.Number,
  tired: Schemas.Boolean
})

export const World = engine.defineComponent('grc::World', {
  tunnel: Schemas.Int,
  tons: Schemas.Number,
  quota: Schemas.Number,
  raidActive: Schemas.Boolean,
  raidEndsAt: Schemas.Int64
})

export const Heartbeat = engine.defineComponent('grc::Heartbeat', { at: Schemas.Int64 })

export const Rooms = engine.defineComponent('grc::Rooms', {
  owners: Schemas.Array(Schemas.String),
  names: Schemas.Array(Schemas.String),
  endsAt: Schemas.Array(Schemas.Int64)
})

/** Ore spilled by a ram; anyone can collect it until it expires. */
export const Pile = engine.defineComponent('grc::Pile', {
  id: Schemas.Int,
  copper: Schemas.Number,
  silver: Schemas.Number,
  gold: Schemas.Number,
  gem: Schemas.Number,
  expiresAt: Schemas.Int64
})

/** A rock of the shared open seam in the tunnel yard. */
export const SeamRock = engine.defineComponent('grc::SeamRock', {
  index: Schemas.Int,
  ore: Schemas.String,
  hp: Schemas.Number,
  maxHp: Schemas.Number,
  alive: Schemas.Boolean
})

export const Bandit = engine.defineComponent('grc::Bandit', { id: Schemas.Int })

export const SYNC_ID = { world: 1, heartbeat: 2, rooms: 3 }

if (isServer()) {
  const serverOnly = (v: { senderAddress: string }) => v.senderAddress === AUTH_SERVER_PEER_ID
  Miner.validateBeforeChange(serverOnly)
  Stamina.validateBeforeChange(serverOnly)
  World.validateBeforeChange(serverOnly)
  Heartbeat.validateBeforeChange(serverOnly)
  Rooms.validateBeforeChange(serverOnly)
  Pile.validateBeforeChange(serverOnly)
  SeamRock.validateBeforeChange(serverOnly)
  Bandit.validateBeforeChange(serverOnly)
}

// ---------- messages ----------

export const room = registerMessages({
  // client -> server (intent only, the server decides the result)
  hello: Schemas.Map({ name: Schemas.String }),
  equipCart: Schemas.Map({ dock: Schemas.Int }),
  unequipCart: Schemas.Map({ ok: Schemas.Boolean }),
  claimRoom: Schemas.Map({ room: Schemas.Int }),
  leaveRoom: Schemas.Map({ ok: Schemas.Boolean }),
  hit: Schemas.Map({ rock: Schemas.Int }), // 0..8 own face, 100+ open seam
  deposit: Schemas.Map({ ok: Schemas.Boolean }),
  buy: Schemas.Map({ kind: Schemas.String }),
  grab: Schemas.Map({ victim: Schemas.String }),
  ram: Schemas.Map({ victim: Schemas.String }),
  collectPile: Schemas.Map({ id: Schemas.Int }),
  scareBandit: Schemas.Map({ id: Schemas.Int }),
  tutorialDone: Schemas.Map({ ok: Schemas.Boolean }),
  pos: Schemas.Map({ x: Schemas.Number, z: Schemas.Number, yaw: Schemas.Number }), // fallback position report
  banditContact: Schemas.Map({ id: Schemas.Int }), // a bandit touched my cart (as my screen shows it)
  playerContact: Schemas.Map({ thief: Schemas.String }), // a rival ran into my cart (as my screen shows it)

  // server -> client
  notify: Schemas.Map({ text: Schemas.String, danger: Schemas.Boolean }),
  banner: Schemas.Map({ text: Schemas.String }),
  roomGranted: Schemas.Map({ room: Schemas.Int }),
  roomEnded: Schemas.Map({ reason: Schemas.String }),
  face: Schemas.Map({
    room: Schemas.Int,
    depth: Schemas.Int,
    ores: Schemas.Array(Schemas.String),
    hp: Schemas.Array(Schemas.Number),
    maxHp: Schemas.Array(Schemas.Number),
    event: Schemas.String, // 'new' | 'hit' | 'burst' | 'slide'
    rock: Schemas.Int
  }),
  swing: Schemas.Map({ ok: Schemas.Boolean }), // a hit was accepted (rock shake + sound)
  deposited: Schemas.Map({ coins: Schemas.Int, tons: Schemas.Number }),
  tackle: Schemas.Map({ x: Schemas.Number, z: Schemas.Number }) // a bandit hit you: knockback from this point
})

// ---------- helpers ----------

export type Load = Record<OreType, number>

export function loadOf(m: Pick<MinerData, OreType>): Load {
  return { copper: m.copper, silver: m.silver, gold: m.gold, gem: m.gem }
}

export function tonsOf(l: Load): number {
  return l.copper + l.silver + l.gold + l.gem
}

export function valueOf(l: Load): number {
  let v = 0
  for (const k of ORE_TYPES) v += l[k] * ORE[k].value
  return Math.floor(v + 1e-6)
}

export function capacityOf(m: Pick<MinerData, 'cart'>): number {
  return CART_CAPACITY[Math.max(1, m.cart) - 1]
}

export function damageOf(m: Pick<MinerData, 'pickaxe'>): number {
  return PICKAXE_DAMAGE[Math.max(1, m.pickaxe) - 1]
}

export function bootsOf(m: Pick<MinerData, 'boots'>) {
  return BOOTS[Math.max(1, m.boots) - 1]
}

export function grabReduction(m: Pick<MinerData, 'cart'>): number {
  return CART_GRAB_REDUCTION[Math.max(1, m.cart) - 1]
}

/** 0 (empty) .. 1 (full): drives the cart-weight slowdown. */
export function loadShare(m: MinerData): number {
  return Math.max(0, Math.min(1, tonsOf(loadOf(m)) / capacityOf(m)))
}

export function fmtTons(t: number): string {
  return t >= 10 || Math.abs(t - Math.round(t)) < 0.05 ? `${Math.round(t)}` : t.toFixed(1)
}

// ---------- session quests (V0 doc) ----------

export const QUESTS = [
  { key: 'mine', text: (g: number) => `Mine ${g} rocks`, goal: 12, reward: 40 },
  { key: 'bigBank', text: (g: number) => (g === 1 ? 'Bank one trip of 15 t+' : `Bank ${g} trips of 15 t+`), goal: 1, reward: 40 },
  { key: 'grabOrBank', text: (g: number) => `Grab ${g * 1.5} t from rivals or bank ${g} times`, goal: 4, reward: 60 }
]

export const BIG_BANK_TONS = 15

export function questGoal(index: number, round: number): number {
  const q = QUESTS[index]
  if (q.key === 'bigBank') return Math.min(3, round)
  return q.goal * round
}

export function questReward(index: number, round: number): number {
  return QUESTS[index].reward * round
}

/** Progress of each quest for display (0..goal). */
export function questProgress(m: MinerData): number[] {
  const r = Math.max(1, m.qRound)
  const g3 = questGoal(2, r)
  return [
    Math.min(questGoal(0, r), m.qMine),
    Math.min(questGoal(1, r), m.qBigBank),
    Math.min(g3, Math.max(m.qBanks, Math.floor((m.qGrab / (g3 * 1.5)) * g3)))
  ]
}
