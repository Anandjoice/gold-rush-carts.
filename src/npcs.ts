// Characters at base: avatars built from Decentraland's free base wearables (nothing to download).
// Each stands in front of their building, turns to face you, waves when you come close, and talks when clicked.
import {
  engine,
  Entity,
  Transform,
  AvatarShape,
  MeshCollider,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { completeTutorial, ui } from './state'

const BASE = 'urn:decentraland:off-chain:base-avatars:'
const FACE = [`${BASE}eyebrows_00`, `${BASE}mouth_00`, `${BASE}eyes_00`]

type NpcDef = {
  id: string // last 4 characters show next to the name, so they are kept tidy
  name: string
  building: string // scene entity the NPC stands in front of
  offset: { x: number; z: number } // metres from that building's centre
  female?: boolean
  outfit: string[]
  hair: { r: number; g: number; b: number }
  skin: { r: number; g: number; b: number }
  lines: string[]
  portrait?: 'foreman'
}

// Positions are offsets from each building, so moving a building in Creator Hub moves its character too.
export const NPC_DEFS: NpcDef[] = [
  {
    id: 'dusty-0001',
    name: 'Foreman Dusty',
    building: 'Vault', // stands between the vault and the spawn, on the way in
    offset: { x: 5, z: 12 },
    outfit: [`${BASE}red_tshirt`, `${BASE}brown_pants`, `${BASE}classic_shoes`, `${BASE}short_hair`],
    hair: { r: 0.35, g: 0.2, b: 0.1 },
    skin: { r: 0.94, g: 0.75, b: 0.6 },
    portrait: 'foreman',
    lines: [
      "Fresh miner, eh? Tunnel One's open and the Company pays by the ton.",
      'Tap a rock, fill your cart, bring it to the vault.',
      'And keep moving. Ore in a cart belongs to whoever holds it last.'
    ]
  },
  {
    id: 'ironjaw-0001',
    name: 'Ironjaw the Smith',
    building: 'Axe_Upgrade_store',
    offset: { x: -6, z: 0 },
    outfit: [`${BASE}black_tshirt`, `${BASE}brown_pants`, `${BASE}classic_shoes`, `${BASE}bald`],
    hair: { r: 0.1, g: 0.1, b: 0.1 },
    skin: { r: 0.7, g: 0.5, b: 0.38 },
    lines: [
      'Better steel, deeper ore.',
      'Pickaxe, cart or boots: tap BUY on the board when you have the coin.',
      'Pickaxe Lv2? That will crack silver.'
    ]
  },
  {
    id: 'wheels-0001',
    name: 'Wheelwright Bo',
    building: 'Cart_Upgrade_Store',
    offset: { x: 6, z: 0 },
    outfit: [`${BASE}green_tshirt`, `${BASE}blue_jeans`, `${BASE}classic_shoes`, `${BASE}curly_hair`],
    hair: { r: 0.55, g: 0.3, b: 0.12 },
    skin: { r: 0.85, g: 0.65, b: 0.5 },
    lines: [
      'Bigger cart, bigger haul.',
      'A loaded cart is a slow cart. Ironjaw sells bigger carts.',
      'Just remember: a full cart is a fat target for bandits.'
    ]
  },
  {
    id: 'clerk-0001',
    name: 'Mae',
    building: 'Vault',
    offset: { x: 0, z: 6.5 },
    female: true,
    outfit: [`${BASE}blue_tshirt`, `${BASE}brown_pants`, `${BASE}classic_shoes`, `${BASE}standard_hair`],
    hair: { r: 0.25, g: 0.18, b: 0.12 },
    skin: { r: 0.9, g: 0.72, b: 0.58 },
    lines: [
      'Welcome to the Vault, miner.',
      'Bring your cart to the counter and tap DEPOSIT. I weigh it and pay you in coin.',
      'This is the safe zone: no stealing here, and your stamina fills right up.'
    ]
  }
]

type Npc = { def: NpcDef; entity: Entity; waved: boolean; waveCount: number }
const npcs: Npc[] = []

export function setupNpcs() {
  for (const def of NPC_DEFS) {
    const building = engine.getEntityOrNullByName(def.building)
    if (!building) {
      console.log(`[GoldRush] NPC ${def.name}: building "${def.building}" not found`)
      continue
    }
    const b = Transform.get(building).position
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(b.x + def.offset.x, 0, b.z + def.offset.z) })
    AvatarShape.create(e, {
      id: def.id,
      name: def.name,
      bodyShape: `${BASE}${def.female ? 'BaseFemale' : 'BaseMale'}`,
      wearables: [...FACE, ...def.outfit],
      hairColor: def.hair,
      skinColor: def.skin,
      emotes: []
    })
    // avatars are skinned meshes and cannot be clicked directly: an invisible box does it
    const hit = engine.addEntity()
    Transform.create(hit, { parent: e, position: Vector3.create(0, 0.95, 0), scale: Vector3.create(0.9, 1.9, 0.9) })
    MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown(
      { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: `Talk to ${def.name}`, maxDistance: 7 } },
      () => openDialog(def)
    )
    npcs.push({ entity: e, def, waved: false, waveCount: 0 })
  }
  engine.addSystem(npcSystem)
}

function openDialog(def: NpcDef) {
  ui.dialog = { name: def.name, lines: def.lines, index: 0, portrait: def.portrait ?? '' }
}

/** Where an NPC stands (for the tutorial arrows), by id. */
export function npcPosition(id: string): Vector3 | null {
  const n = npcs.find((x) => x.def.id === id)
  return n ? Vector3.clone(Transform.get(n.entity).position) : null
}

function npcSystem() {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) return
  for (const n of npcs) {
    const t = Transform.getMutable(n.entity)
    const dx = p.x - t.position.x
    const dz = p.z - t.position.z
    const dist = Math.hypot(dx, dz)
    // turn to face the player when they are around
    if (dist < 12) {
      const target = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
      t.rotation = Quaternion.slerp(t.rotation, target, 0.1)
    }
    // wave once each time the player walks up
    if (dist < 6 && !n.waved) {
      n.waved = true
      n.waveCount++
      const a = AvatarShape.getMutable(n.entity)
      a.expressionTriggerId = 'wave'
      a.expressionTriggerTimestamp = n.waveCount
    } else if (dist > 10) n.waved = false
    // walking away closes their speech box
    if (ui.dialog && ui.dialog.name === n.def.name && dist > 10) ui.dialog = null
  }
}
