// Client gameplay: carts, dock, claim rooms, the 3x3 ore face, open seam, piles, stealing clicks, running limits.
// The client never decides an outcome: it shows synced state and sends intents to the Multiplayer Server.
import {
  engine,
  Entity,
  Transform,
  GltfContainer,
  VisibilityComponent,
  MeshCollider,
  MeshRenderer,
  Material,
  pointerEventsSystem,
  InputAction,
  ColliderLayer,
  Tween,
  EasingFunction,
  AvatarAttach,
  AvatarAnchorPointType,
  TextShape,
  Billboard,
  Name,
  inputSystem,
  PointerEventType,
  AvatarLocomotionSettings,
  PlayerIdentityData,
  ParticleSystem,
  Physics
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import { CONFIG, NAMES, ORE, ORE_TYPES, OreType } from './config'
import { capacityOf, fmtTons, loadOf, Miner, Pile, room, SeamRock, tonsOf } from './shared'
import {
  cartFull,
  cartTons,
  completeTutorial,
  heartbeatSystem,
  loaded,
  slowdown,
  me,
  myDisplayName,
  myId,
  myStamina,
  reachTutorial,
  rooms,
  serverAlive,
  showBanner,
  showToast,
  ui,
  TutorialStep
} from './state'
import { setupGuide } from './guide'
import { npcPosition } from './npcs'
import { playSfx } from './music'
import { setupBandits } from './bandits'

// ---------- helpers ----------

function byName(name: string): Entity | null {
  const e = engine.getEntityOrNullByName(name)
  if (!e) console.log(`[GoldRush] entity "${name}" not found in the scene`)
  return e
}

function hide(e: Entity) {
  VisibilityComponent.createOrReplace(e, { visible: false })
  if (MeshCollider.has(e)) MeshCollider.deleteFrom(e)
  const g = GltfContainer.getMutableOrNull(e)
  if (g) {
    g.visibleMeshesCollisionMask = 0
    g.invisibleMeshesCollisionMask = 0
  }
}

function playerPos(): Vector3 | null {
  return Transform.getOrNull(engine.PlayerEntity)?.position ?? null
}

function flatDist(a: Vector3, b: Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function pos(e: Entity | null): Vector3 {
  return e ? worldTransform(e).position : Vector3.Zero()
}

function worldTransform(e: Entity): { position: Vector3; rotation: Quaternion; scale: Vector3 } {
  const t = Transform.get(e)
  const local = { position: Vector3.clone(t.position), rotation: Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w), scale: Vector3.clone(t.scale) }
  if (!t.parent || t.parent === engine.RootEntity || !Transform.has(t.parent)) return local
  const p = worldTransform(t.parent)
  const scaled = Vector3.create(local.position.x * p.scale.x, local.position.y * p.scale.y, local.position.z * p.scale.z)
  return {
    position: Vector3.add(p.position, Vector3.rotate(scaled, p.rotation)),
    rotation: Quaternion.multiply(p.rotation, local.rotation),
    scale: Vector3.create(local.scale.x * p.scale.x, local.scale.y * p.scale.y, local.scale.z * p.scale.z)
  }
}

function oreColor3(k: OreType) {
  return Color3.create(ORE[k].color.r, ORE[k].color.g, ORE[k].color.b)
}

// ---------- scene references ----------

let vault: Entity | null = null
let forge: Entity | null = null
let cartShop: Entity | null = null
let tunnelPad: Entity | null = null
let returnPad: Entity | null = null
const roomPads: (Entity | null)[] = []
const walls: (Entity | null)[] = []
const wallStart: (Vector3 | null)[] = []
let cartSrc = 'assets/Models/Cart/Cart.glb'
let cartScale = Vector3.create(1.5, 1.5, 1.5)
let cartBaseY = 0.45

// ---------- dock ----------

const docks: Entity[] = []

function setupDocks() {
  NAMES.docks.forEach((name, i) => {
    const dock = byName(name)
    if (!dock) return
    if (docks.length === 0) {
      cartScale = Vector3.clone(Transform.get(dock).scale)
      cartBaseY = CONFIG.groundY + CONFIG.cartModelHalfHeight * cartScale.y
      cartSrc = GltfContainer.get(dock).src
    }
    Transform.getMutable(dock).position.y = CONFIG.groundY + CONFIG.cartModelHalfHeight * Transform.get(dock).scale.y
    const g = GltfContainer.getMutable(dock)
    g.visibleMeshesCollisionMask = ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS
    g.invisibleMeshesCollisionMask = 0
    pointerEventsSystem.onProximityDown(
      { entity: dock, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Take cart', maxDistance: 3 } },
      () => takeDockCart(i, dock)
    )
    pointerEventsSystem.onPointerDown(
      { entity: dock, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Take cart', maxDistance: 6 } },
      () => takeDockCart(i, dock)
    )
    docks.push(dock)
  })
}

export function nearestDock(): Vector3 | null {
  const p = playerPos()
  let best: Vector3 | null = null
  let bestD = Infinity
  for (const d of docks) {
    const dp = Transform.get(d).position
    const dist = p ? flatDist(p, dp) : 0
    if (dist < bestD) {
      bestD = dist
      best = dp
    }
  }
  return best
}

function takeDockCart(index: number, dock: Entity) {
  const d = me()
  if (!d || !serverAlive()) return showToast('Connecting to the mine office... try again in a moment.')
  if (d.hasCart) return showToast('You already have a cart. Press F to put an empty one away.')
  void room.send('equipCart', { dock: index })
  // the cart leaves the dock and a new one rolls into its place, so 5 are always waiting
  const base = Vector3.clone(Transform.get(dock).scale)
  Tween.createOrReplace(dock, { mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: base }), duration: 450, easingFunction: EasingFunction.EF_EASEOUTBACK })
}

function unequipSystem() {
  if (!inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) return
  const d = me()
  if (!d || !d.hasCart) return
  if (d.room > 0) return showToast('Take your cart out of the mine first!', true)
  if (cartTons() > 0.01) return showToast('Deposit your ore at the vault first!', true)
  void room.send('unequipCart', { ok: true })
  showToast('Cart put away. Grab another one from the dock any time.')
}

// ---------- carts (everyone's, drawn locally from synced data) ----------

const HEAP_SLOTS: Vector3[] = []
for (const y of [0.12, 0.24]) for (const z of [-0.12, 0.12]) for (const x of [-0.26, 0, 0.26]) HEAP_SLOTS.push(Vector3.create(x, y, z))

type CartView = {
  anchor: Entity // AvatarAttach on the owner's avatar: the Explorer moves it with the avatar it draws
  cart: Entity
  heap: { entity: Entity; ore: OreType | null }[]
  glow: Entity
  band: Entity
  tier: number
  label: Entity
  hitBox: Entity | null
  offering: boolean // my cart: the "Take your cart" prompt is live
  key: string
}
const carts = new Map<string, CartView>()

function avatarOf(address: string): Entity | null {
  if (address === myId()) return engine.PlayerEntity
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) if (id.address.toLowerCase() === address) return e
  return null
}

/** Cart offset from the avatar root: in front of the player, wheels on the ground. */
function cartLocalPose() {
  return {
    position: Vector3.create(0, cartBaseY - CONFIG.groundY + CONFIG.cartAttachYOffset, CONFIG.cartFrontDistance),
    rotation: Quaternion.fromEulerDegrees(0, CONFIG.cartYawOffset, 0)
  }
}

function makeCart(address: string, name: string): CartView {
  const anchor = engine.addEntity() // kept for removeCart; the cart itself is placed every frame (cartSystem)
  const cart = engine.addEntity()
  Transform.create(cart, { scale: cartScale })
  GltfContainer.create(cart, { src: cartSrc, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  // glowing heap: an emissive slab inside the cart that rises and brightens with the cart's value
  const glow = engine.addEntity()
  Transform.create(glow, { parent: cart, position: Vector3.create(0, 0.05, 0), scale: Vector3.create(0.7, 0.02, 0.35) })
  MeshRenderer.setBox(glow)
  VisibilityComponent.create(glow, { visible: false })
  const label = engine.addEntity()
  Transform.create(label, { parent: cart, position: Vector3.create(0, 1.2, 0), scale: Vector3.create(0.45, 0.45, 0.45) })
  TextShape.create(label, {
    text: '',
    fontSize: 3,
    textColor: Color4.White(),
    outlineWidth: 0.3,
    outlineColor: Color3.Black(),
    fontSrc: 'assets/fonts/LilitaOne-Regular.ttf'
  })
  Billboard.create(label)
  let hitBox: Entity | null = null
  if (address === myId()) {
    // my own cart: its "Take your cart" prompt is switched on only while it is parked in the room (cartSystem)
    hitBox = engine.addEntity()
    Transform.create(hitBox, { parent: cart, scale: Vector3.create(1.05, 0.9, 0.8) })
    // pops in when it is equipped
    Tween.create(cart, { mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: cartScale }), duration: 400, easingFunction: EasingFunction.EF_EASEOUTBACK })
  } else {
    hitBox = engine.addEntity()
    Transform.create(hitBox, { parent: cart, scale: Vector3.create(1.05, 0.9, 0.8) })
    MeshCollider.setBox(hitBox, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown(
      { entity: hitBox, opts: { button: InputAction.IA_ANY, hoverText: `Click: grab ore · E: ram ${name}`, maxDistance: CONFIG.ramRange + 1.5 } },
      (ev) => {
        if (ev.button === InputAction.IA_PRIMARY) ramCart(address)
        else if (ev.button === InputAction.IA_POINTER) grabCart(address)
      }
    )
  }
  // tier mark: a coloured trim band around the cart (V0 keeps the Lv1 model for every tier)
  const band = engine.addEntity()
  Transform.create(band, { parent: cart, position: Vector3.create(0, 0.22, 0), scale: Vector3.create(0.82, 0.05, 0.46) })
  MeshRenderer.setBox(band)
  VisibilityComponent.create(band, { visible: false })
  return { anchor, cart, heap: [], glow, band, tier: 0, label, hitBox, offering: false, key: '' }
}

function removeCart(v: CartView) {
  for (const h of v.heap) engine.removeEntity(h.entity)
  for (const e of [v.glow, v.band, v.label, v.hitBox, v.cart, v.anchor]) if (e !== null) engine.removeEntity(e)
}

// Lv1 plain wood (no band), Lv2 metal corners, Lv3 iron, Lv4 steel, Lv5 brass that glows
const TIER_COLORS = [
  Color4.create(0.45, 0.3, 0.18, 1),
  Color4.create(0.55, 0.5, 0.45, 1),
  Color4.create(0.3, 0.3, 0.32, 1),
  Color4.create(0.72, 0.76, 0.82, 1),
  Color4.create(0.9, 0.68, 0.25, 1)
]

let parkedAt: Vector3 | null = null

function cartSystem() {
  const mine = myId()
  const seen = new Set<string>()
  for (const [, d] of engine.getEntitiesWith(Miner)) {
    if (!d.hasCart) continue
    const owner = avatarOf(d.address)
    if (!owner) continue // owner not in the scene
    const pt = Transform.getOrNull(owner)
    if (!pt) continue
    seen.add(d.address)
    let v = carts.get(d.address)
    if (!v) {
      v = makeCart(d.address, d.name)
      carts.set(d.address, v)
    }
    if (d.address === mine && v.hitBox) {
      // "Take your cart" only while it waits beside the ore face (one prompt, gone once taken)
      const offer = ui.inRoom > 0 && !ui.cartTaken
      if (offer !== v.offering) {
        v.offering = offer
        if (offer) {
          MeshCollider.setBox(v.hitBox, ColliderLayer.CL_POINTER)
          pointerEventsSystem.onProximityDown({ entity: v.hitBox, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Take your cart', maxDistance: 3.5 } }, () => takeMyCart())
        } else {
          pointerEventsSystem.removeOnProximityDown(v.hitBox)
          if (MeshCollider.has(v.hitBox)) MeshCollider.deleteFrom(v.hitBox)
        }
      }
    }
    if (d.address === mine) {
      // MY cart: a child of engine.PlayerEntity, so the Explorer itself carries it with the avatar. The scene never
      // computes its position, so a stale player position (seen after the room-exit teleport) cannot leave it behind.
      const ct = Transform.get(v.cart)
      if (ui.inRoom > 0 && parkedAt && !ui.cartTaken) {
        // parked beside the ore face while mining
        if (ct.parent !== undefined || ct.position.x !== parkedAt.x || ct.position.z !== parkedAt.z) {
          const w = Transform.getMutable(v.cart)
          w.parent = undefined
          w.position = Vector3.clone(parkedAt)
          w.rotation = Quaternion.fromEulerDegrees(0, 90 + CONFIG.cartYawOffset, 0)
        }
      } else if (ct.parent !== engine.PlayerEntity) {
        // wheels on the ground: offset down from the player's origin to the cart's resting height
        const lift = Math.max(-1.5, Math.min(1, cartBaseY - pt.position.y + CONFIG.cartAttachYOffset))
        const w = Transform.getMutable(v.cart)
        w.parent = engine.PlayerEntity
        w.position = Vector3.create(0, lift, CONFIG.cartFrontDistance)
        w.rotation = Quaternion.fromEulerDegrees(0, CONFIG.cartYawOffset, 0)
      }
    } else {
      // other players' carts: placed in front of their avatar from the synced player transform
      const ct = Transform.getMutable(v.cart)
      const fwd = Vector3.rotate(Vector3.Forward(), pt.rotation)
      const len = Math.hypot(fwd.x, fwd.z) || 1
      const fx = fwd.x / len
      const fz = fwd.z / len
      ct.position = Vector3.create(pt.position.x + fx * CONFIG.cartFrontDistance, cartBaseY, pt.position.z + fz * CONFIG.cartFrontDistance)
      ct.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(fx, fz) * 180) / Math.PI + CONFIG.cartYawOffset, 0)
    }
    const l = loadOf(d)
    const tons = tonsOf(l)
    const cap = capacityOf(d)
    const text = d.address === mine ? '' : `${d.name}\n${fmtTons(tons)} / ${cap} t`
    const ts = TextShape.getMutable(v.label)
    if (ts.text !== text) ts.text = text
    updateHeap(v, l, cap)
    if (v.tier !== d.cart) {
      v.tier = d.cart
      const col = TIER_COLORS[Math.max(1, d.cart) - 1]
      VisibilityComponent.getMutable(v.band).visible = d.cart > 1
      Material.setPbrMaterial(v.band, { albedoColor: col, metallic: d.cart >= 3 ? 0.8 : 0.1, roughness: 0.4, emissiveColor: d.cart === 5 ? Color3.create(1, 0.75, 0.3) : Color3.Black(), emissiveIntensity: d.cart === 5 ? 1.5 : 0 })
    }
  }
  for (const [address, v] of carts) {
    if (seen.has(address)) continue
    removeCart(v)
    carts.delete(address)
  }
}

function updateHeap(v: CartView, load: Record<OreType, number>, capacity: number) {
  const count = tonsOf(load)
  const key = ORE_TYPES.map((k) => load[k].toFixed(1)).join(',') + '/' + capacity
  if (key === v.key) return
  v.key = key
  const fill = Math.min(1, count / Math.max(1, capacity))
  const shown = count <= 0.01 ? 0 : Math.max(1, Math.round(fill * HEAP_SLOTS.length))
  const types: OreType[] = []
  for (const k of ORE_TYPES) {
    const n = Math.round((load[k] / Math.max(0.01, count)) * shown)
    for (let i = 0; i < n; i++) types.push(k)
  }
  while (types.length < shown) types.push(ORE_TYPES.find((k) => load[k] > 0) ?? 'copper')
  types.length = shown
  const scale = Transform.get(v.cart).scale.x
  HEAP_SLOTS.forEach((slot, i) => {
    let h = v.heap[i]
    if (!h) {
      const e = engine.addEntity()
      Transform.create(e, { parent: v.cart, position: slot, rotation: Quaternion.fromEulerDegrees(0, i * 47, 0) })
      h = v.heap[i] = { entity: e, ore: null }
    }
    const ore = types[i] ?? null
    if (ore === h.ore) return
    h.ore = ore
    const src = ore ? ORE[ore].model : undefined
    if (!ore || !src) {
      if (GltfContainer.has(h.entity)) GltfContainer.deleteFrom(h.entity)
      return
    }
    GltfContainer.createOrReplace(h.entity, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    const s = CONFIG.heapPieceSize / (ORE[ore].modelSize * scale)
    Transform.getMutable(h.entity).scale = Vector3.create(s, s, s)
  })
  // glow: colour of the most valuable ore aboard, brighter as the cart's value grows
  const top = [...ORE_TYPES].reverse().find((k) => load[k] > 0.01)
  VisibilityComponent.getMutable(v.glow).visible = !!top
  if (top) {
    let value = 0
    for (const k of ORE_TYPES) value += load[k] * ORE[k].value
    Transform.getMutable(v.glow).position = Vector3.create(0, 0.05 + 0.22 * fill, 0)
    Material.setPbrMaterial(v.glow, {
      albedoColor: Color4.create(oreColor3(top).r, oreColor3(top).g, oreColor3(top).b, 1),
      emissiveColor: oreColor3(top),
      emissiveIntensity: Math.min(4, 0.4 + value / 25),
      castShadows: false
    })
  }
}

/** World position of my cart (parked: its own position; following: in front of the player). */
export function myCartPosition(): Vector3 | null {
  const v = carts.get(myId())
  if (!v) return null
  const t = Transform.get(v.cart)
  if (t.parent !== engine.PlayerEntity) return t.position
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p) return null
  return Vector3.add(p.position, Vector3.rotate(Vector3.create(0, t.position.y, t.position.z), p.rotation))
}

// ---------- label beside the player ----------

let sideLabel: Entity | null = null

function setupSideLabel() {
  sideLabel = engine.addEntity()
  Transform.create(sideLabel, {
    parent: engine.PlayerEntity,
    position: Vector3.create(CONFIG.sideLabelOffset.x, CONFIG.sideLabelOffset.y, CONFIG.sideLabelOffset.z),
    scale: Vector3.create(0.45, 0.45, 0.45)
  })
  // big white text with a thick black outline, readable on any background
  TextShape.create(sideLabel, {
    text: '',
    fontSize: 3,
    textColor: Color4.White(),
    outlineWidth: 0.3,
    outlineColor: Color3.Black(),
    fontSrc: 'assets/fonts/LilitaOne-Regular.ttf'
  })
  Billboard.create(sideLabel)
}

function sideLabelSystem() {
  if (!sideLabel) return
  const d = me()
  let text = ''
  if (d && d.hasCart) {
    const t = cartTons()
    text = t <= 0.01 && ui.inRoom === 0 ? 'Press F to unequip' : `${fmtTons(t)} / ${capacityOf(d)} t`
  }
  const ts = TextShape.getMutable(sideLabel)
  if (ts.text !== text) ts.text = text
}

// ---------- cart weight and TIRED ----------


// The fuller the cart, the slower you move (up to CONFIG.loadSlowdownMax at a full cart).
// TIRED (0 stamina, 3 s) also stops running. Done with locomotion speeds, so input stays untouched.
let speedKey = ''
function runLimitSystem() {
  const f = 1 - slowdown()
  const tired = myStamina().tired
  const key = `${f}|${tired}`
  if (key === speedKey) return
  speedKey = key
  if (f >= 1 && !tired) {
    AvatarLocomotionSettings.deleteFrom(engine.PlayerEntity)
    return
  }
  const jog = CONFIG.baseJogSpeed * f
  AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, { jogSpeed: jog, runSpeed: tired ? jog : CONFIG.baseRunSpeed * f })
}

// ---------- pickaxe in hand ----------

let axeAnchor: Entity | null = null
let axeGrip: Entity | null = null
let axeModel: Entity | null = null

export function applyAxeTransform() {
  if (!axeGrip || !axeModel) return
  const t = ui.axeTune
  const g = Transform.getMutable(axeGrip)
  g.position = Vector3.create(t.px, t.py, t.pz)
  g.rotation = Quaternion.fromEulerDegrees(t.rx, t.ry, t.rz)
  g.scale = Vector3.create(t.scale, t.scale, t.scale)
  Transform.getMutable(axeModel).position = Vector3.create(0, CONFIG.axeHandleShift, 0)
}

function equipAxe() {
  if (axeAnchor) return
  axeAnchor = engine.addEntity()
  AvatarAttach.create(axeAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  axeGrip = engine.addEntity()
  Transform.create(axeGrip, { parent: axeAnchor })
  axeModel = engine.addEntity()
  Transform.create(axeModel, { parent: axeGrip })
  GltfContainer.create(axeModel, { src: CONFIG.axeModel, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  applyAxeTransform()
}

function unequipAxe() {
  for (const e of [axeModel, axeGrip, axeAnchor]) if (e) engine.removeEntity(e)
  axeModel = null
  axeGrip = null
  axeAnchor = null
}

/** The pickaxe is in hand only inside a claim room (or at the open seam while it is in use); hidden everywhere else. */
function axeVisibilitySystem() {
  const p = playerPos()
  const atSeam = !!p && seamOpen() && Math.hypot(p.x - CONFIG.seamOrigin.x, p.z - CONFIG.seamOrigin.z) < CONFIG.seamSpacing * 2 + CONFIG.mineReach
  if (ui.inRoom > 0 || atSeam) equipAxe()
  else unequipAxe()
}

let swingCooldown = 0

function swing(): boolean {
  if (swingCooldown > 0) return false
  if (myStamina().tired) {
    showToast('Too tired! Catch your breath.', true)
    return false
  }
  swingCooldown = CONFIG.swingCooldown
  void triggerEmote({ predefinedEmote: CONFIG.swingEmote })
  // fallback if the emote does not play: a quick chop of the model in hand
  if (axeGrip) {
    const t = ui.axeTune
    Tween.createOrReplace(axeGrip, {
      mode: Tween.Mode.Rotate({ start: Quaternion.fromEulerDegrees(t.rx - 60, t.ry, t.rz), end: Quaternion.fromEulerDegrees(t.rx, t.ry, t.rz) }),
      duration: 300,
      easingFunction: EasingFunction.EF_EASEOUTQUAD
    })
  }
  return true
}

// ---------- claim rooms ----------

const roomSigns: Entity[] = []

function setupRoomSigns() {
  roomPads.forEach((pad, i) => {
    const e = engine.addEntity()
    const p = pad ? Transform.get(pad).position : Vector3.Zero()
    Transform.create(e, { position: Vector3.create(p.x, 3.4, p.z), scale: Vector3.create(0.5, 0.5, 0.5) })
    TextShape.create(e, {
      text: `ROOM ${i + 1}`,
      fontSize: 3,
      textColor: Color4.fromHexString('#FFF4E0FF'),
      outlineWidth: 0.2,
      outlineColor: Color3.fromHexString('#2B1D14'),
      fontSrc: 'assets/fonts/LilitaOne-Regular.ttf'
    })
    Billboard.create(e)
    roomSigns.push(e)
  })
}

function roomSystem() {
  const r = rooms()
  if (!r) return
  roomSigns.forEach((e, i) => {
    const text = r.owners[i] ? `ROOM ${i + 1}\n${r.names[i]}` : `ROOM ${i + 1}\nFREE`
    const ts = TextShape.getMutable(e)
    if (ts.text !== text) {
      ts.text = text
      ts.textColor = r.owners[i] ? Color4.fromHexString('#FFC83DFF') : Color4.fromHexString('#9BE37AFF')
    }
  })
  // only the owner may be inside a claimed room: anyone else is moved out
  const p = playerPos()
  if (!p) return
  const id = myId()
  roomPads.forEach((pad, i) => {
    if (!pad || ui.inRoom === i + 1) return
    if (r.owners[i] && r.owners[i] !== id && flatDist(p, Transform.get(pad).position) < CONFIG.roomRadius) {
      showToast(`Room ${i + 1} is claimed by ${r.names[i]}.`, true)
      teleportOut()
    }
  })
}

export function claimRoom(n: number) {
  const d = me()
  if (!d) return
  if (!d.hasCart) return showToast('Take a cart from the dock first!', true)
  void room.send('claimRoom', { room: n })
}

export function leaveRoom() {
  void room.send('leaveRoom', { ok: true })
}

function teleportOut() {
  const rp = pos(returnPad)
  const vp = pos(vault)
  void movePlayerTo({
    newRelativePosition: Vector3.create(rp.x, rp.y + 0.2, rp.z),
    cameraTarget: Vector3.create(vp.x, 1.5, vp.z)
  })
}

function enterRoom(n: number) {
  const pad = roomPads[n - 1]
  const wall = walls[n - 1]
  if (!pad || !wall) return
  ui.inRoom = n
  ui.roomSince = Date.now()
  ui.cartTaken = false
  const sp = Transform.get(pad).position
  const wp = wallStart[n - 1] ?? Transform.get(wall).position
  void movePlayerTo({
    newRelativePosition: Vector3.create(sp.x, sp.y + 0.2, sp.z),
    cameraTarget: Vector3.create(wp.x, 1.5, wp.z)
  })
  const dir = sp.z >= wp.z ? 1 : -1
  parkedAt = Vector3.create(wp.x + CONFIG.cartParkSide + 1, cartBaseY, wp.z + dir * (1.5 + CONFIG.cartParkFront))
  completeTutorial('enterTunnel')
}

/** HUD button: put my cart (at its current upgrade level) in front of me, attached. */
export function equipCart() {
  const d = me()
  if (!d || d.hasCart) return
  if (ui.inRoom > 0) return
  void room.send('equipCart', { dock: -1 })
}

/** HUD button: put an empty cart away (same as F). */
export function putCartAway() {
  const d = me()
  if (!d || !d.hasCart) return
  if (ui.inRoom > 0) return showToast('Take your cart out of the mine first!', true)
  if (cartTons() > 0.01) return showToast('Deposit your ore at the vault first!', true)
  void room.send('unequipCart', { ok: true })
}

/** E or F anywhere in the room (mobile: the E / F buttons) takes the full cart, no need to aim at it. */
function takeCartKeySystem() {
  if (ui.inRoom === 0 || ui.cartTaken || !cartFull()) return
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) || inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) takeMyCart()
}

/** E on my parked cart in the room (or the TAKE CART button): take it back once it is full; then EXIT appears. */
export function takeMyCart() {
  if (ui.inRoom === 0 || ui.cartTaken) return
  if (!cartFull()) return showToast(`Fill your cart first: ${fmtTons(cartTons())} / ${me() ? capacityOf(me()!) : 0} t`)
  ui.cartTaken = true
  showToast('Cart taken! Click EXIT to haul it out.')
}

function exitRoom(reason: string) {
  const n = ui.inRoom
  ui.inRoom = 0
  ui.cartTaken = false
  parkedAt = null
  slide = null
  if (n > 0) {
    resetFace(n)
    const w = walls[n - 1]
    const s = wallStart[n - 1]
    if (w && s) Transform.getMutable(w).position = Vector3.clone(s)
  }
  teleportOut()
  if (reason === 'time') showToast("Time's up! You were moved out with your cart.", true)
  if (cartTons() > 0.01) reachTutorial('runToVault')
}

// ---------- the 3x3 ore face (the cubes and ore crystals placed on each room wall) ----------
// Clicking anywhere on the face (Rock_Stroke box, a cube or a crystal) is a swing; the server picks the
// next rock. A burst cell drops to the floor; clearing all 9 slides the wall back and the face is rebuilt.

type CellPart = { entity: Entity; pos: Vector3; scale: Vector3; rot: Quaternion; src: string }
type Cell = { cube: CellPart; ores: CellPart[]; ore: OreType; hp: number; maxHp: number; fallen: boolean }
const roomCells: Cell[][] = []
let slide: { room: number; t: number; pending: FaceMsg | null } | null = null
// cells in the air: they pop forward off the wall first (so they never pass through the rows below), then drop
const falling: { cell: Cell; t: number; floor: number; spin: number }[] = []
const POP_SECONDS = 0.15
const POP_OUT = 0.14 // wall-local units (x10 = metres) in front of the face
const GRAVITY_LOCAL = 2.2 // wall-local units per second squared (a little faster than real, reads better)

type FaceMsg = { room: number; depth: number; ores: string[]; hp: number[]; maxHp: number[]; event: string; rock: number }

function part(e: Entity): CellPart {
  const t = Transform.get(e)
  return {
    entity: e,
    pos: Vector3.clone(t.position),
    scale: Vector3.clone(t.scale),
    rot: Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w),
    src: GltfContainer.getOrNull(e)?.src ?? ''
  }
}

function setupCells(stroke: (Entity | null)[]) {
  walls.forEach((wall, r) => {
    const cells: Cell[] = []
    roomCells[r] = cells
    if (!wall) return
    const cubes: Entity[] = []
    const ores: Entity[] = []
    for (const [e, t] of engine.getEntitiesWith(Transform)) {
      if (t.parent !== wall || e === stroke[r]) continue
      if (GltfContainer.has(e)) ores.push(e)
      else if (MeshRenderer.has(e)) cubes.push(e)
    }
    // rows top to bottom, then left to right
    cubes.sort((a, b) => {
      const pa = Transform.get(a).position
      const pb = Transform.get(b).position
      return Math.abs(pa.y - pb.y) > 0.02 ? pb.y - pa.y : pa.x - pb.x
    })
    for (const c of cubes.slice(0, 9)) cells.push({ cube: part(c), ores: [], ore: 'copper', hp: 1, maxHp: 1, fallen: false })
    // each crystal belongs to the nearest cube
    for (const o of ores) {
      const op = Transform.get(o).position
      let best: Cell | null = null
      let bestD = Infinity
      for (const c of cells) {
        const d = Math.hypot(op.x - c.cube.pos.x, op.y - c.cube.pos.y)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (best) best.ores.push(part(o))
    }
    // every part of the face is a target, so there is no exact point to aim at
    const targets = [stroke[r], ...cubes, ...ores].filter((e): e is Entity => !!e)
    for (const e of targets) {
      // the whole face is click-only: no physics, so the player never bumps into the rocks (on the wall or fallen)
      if (e === stroke[r]) VisibilityComponent.createOrReplace(e, { visible: false })
      if (MeshCollider.has(e) || e === stroke[r]) MeshCollider.setBox(e, ColliderLayer.CL_POINTER)
      const g = GltfContainer.getMutableOrNull(e)
      if (g) {
        g.visibleMeshesCollisionMask = ColliderLayer.CL_POINTER
        g.invisibleMeshesCollisionMask = 0
      }
      pointerEventsSystem.onPointerDown(
        { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Mine', maxDistance: CONFIG.mineReach } },
        () => hitFace(r + 1)
      )
    }
    if (cells.length < 9) console.log(`[GoldRush] Room${r + 1}Wall1 has ${cells.length} cubes (expected 9)`)
  })
}

function showCell(c: Cell, visible: boolean) {
  for (const p of [c.cube, ...c.ores]) {
    if (Tween.has(p.entity)) Tween.deleteFrom(p.entity)
    const t = Transform.getMutable(p.entity)
    t.position = Vector3.clone(p.pos)
    t.scale = Vector3.clone(p.scale)
    t.rotation = Quaternion.create(p.rot.x, p.rot.y, p.rot.z, p.rot.w)
    VisibilityComponent.createOrReplace(p.entity, { visible })
  }
}

/** Puts the face back as built in the scene (used when leaving a room). */
function resetFace(room: number) {
  for (const c of roomCells[room - 1] ?? []) {
    c.fallen = false
    // back to a neutral rock look. NEVER write an empty Material ({}): this Explorer throws on it in
    // StartMaterialsLoadingSystem and, after a few, suspends the whole scene (that froze the cart after EXIT).
    Material.setPbrMaterial(c.cube.entity, { albedoColor: Color4.create(0.85, 0.85, 0.85, 1), metallic: 0, roughness: 0.9 })
    for (const o of c.ores) {
      const g = GltfContainer.getMutableOrNull(o.entity)
      if (g && o.src && g.src !== o.src) g.src = o.src
    }
    showCell(c, true)
  }
}

/** Each rock is tinted by the ore it holds (copper orange, silver grey, gold amber, gem purple), a little
 *  darker than the ore itself so it still reads as rock. */
function oreRockColor(ore: OreType): Color4 {
  const c = ORE[ore].color
  const k = 0.75
  return Color4.create(c.r * k, c.g * k, c.b * k, 1)
}

function applyFace(msg: FaceMsg) {
  const cells = roomCells[msg.room - 1] ?? []

  cells.forEach((c, i) => {
    c.ore = (msg.ores[i] as OreType) ?? 'copper'
    c.hp = msg.hp[i] ?? 0
    c.maxHp = msg.maxHp[i] ?? 1
    c.fallen = c.hp <= 0
    Material.setPbrMaterial(c.cube.entity, { albedoColor: oreRockColor(c.ore), metallic: c.ore === 'silver' || c.ore === 'gold' ? 0.3 : 0, roughness: 0.85 })
    // the crystals stay exactly as placed in the scene; the ore you get shows in the flying chunk and the cart
    for (const o of c.ores) {
      const g = GltfContainer.getMutableOrNull(o.entity)
      if (g && o.src && g.src !== o.src) g.src = o.src
    }
    showCell(c, !c.fallen)
  })
  ui.depthShown = msg.depth
}

/** Same rule as the server: the first standing rock the pickaxe can break. */
function nextRock(cells: Cell[], pickaxe: number): number {
  return cells.findIndex((c) => !c.fallen && c.hp > 0 && pickaxe >= ORE[c.ore].needs)
}

function hitFace(n: number) {
  const d = me()
  if (!d || n !== ui.inRoom || slide) return
  const cells = roomCells[n - 1] ?? []
  const i = nextRock(cells, d.pickaxe)
  if (i < 0) {
    const locked = cells.find((c) => !c.fallen && c.hp > 0)
    if (locked) return showToast(`Needs Pickaxe Lv${ORE[locked.ore].needs} — see Ironjaw`, true)
    return
  }
  if (cartFull()) return showToast(ui.cartTaken ? 'Cart full! Click EXIT to haul it out.' : 'Cart full! Press E on your cart to take it.', true)
  if (!swing()) return
  shakeCell(cells[i])
  void room.send('hit', { rock: -1 })
}

function shake(e: Entity, base: Vector3) {
  Tween.createOrReplace(e, { mode: Tween.Mode.Scale({ start: Vector3.scale(base, 1.08), end: base }), duration: 160, easingFunction: EasingFunction.EF_EASEOUTQUAD })
}

let dust: Entity | null = null

/** A puff of rock dust where the pickaxe lands. */
function dustPuff(at: Vector3) {
  if (!dust) {
    dust = engine.addEntity()
    Transform.create(dust, {})
  }
  Transform.getMutable(dust).position = at
  ParticleSystem.createOrReplace(dust, {
    active: true,
    loop: false,
    rate: 0,
    lifetime: 0.9,
    maxParticles: 30,
    initialSize: { start: 0.15, end: 0.35 },
    sizeOverTime: { start: 1, end: 1.8 },
    initialColor: { start: Color4.create(0.62, 0.5, 0.38, 0.9), end: Color4.create(0.5, 0.42, 0.34, 0.8) },
    colorOverTime: { start: Color4.create(0.6, 0.5, 0.4, 0.8), end: Color4.create(0.6, 0.5, 0.4, 0) },
    initialVelocitySpeed: { start: 0.6, end: 1.6 },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.35 }),
    bursts: { values: [{ time: 0, count: 22, cycles: 1, interval: 0.01, probability: 1 }] }
  })
}

function shakeCell(c: Cell) {
  dustPuff(worldTransform(c.cube.entity).position)
  for (const p of [c.cube, ...c.ores]) {
    Tween.createOrReplace(p.entity, { mode: Tween.Mode.Scale({ start: Vector3.scale(p.scale, 1.12), end: p.scale }), duration: 160, easingFunction: EasingFunction.EF_EASEOUTQUAD })
  }
}

/** A burst cell tumbles to the floor in front of the wall, then disappears. */
function dropCell(room: number, c: Cell) {
  c.fallen = true
  const wall = walls[room - 1]
  const ws = wall ? Transform.get(wall).scale : Vector3.create(10, 10, 10)
  const wy = wall ? Transform.get(wall).position.y : 3
  const floorLocal = (CONFIG.groundY + 0.5 - wy) / (ws.y || 1)
  for (const p of [c.cube, ...c.ores]) if (Tween.has(p.entity)) Tween.deleteFrom(p.entity)
  falling.push({ cell: c, t: 0, floor: floorLocal, spin: Math.random() < 0.5 ? -1 : 1 })
  if (c.ores[0]) flyToCart(worldTransform(c.ores[0].entity).position, c.ore)
  else flyToCart(worldTransform(c.cube.entity).position, c.ore)
  playSfx(CONFIG.breakSound, CONFIG.breakVolume)
}

/** Ore chunk flies from a rock into the cart. */
function flyToCart(from: Vector3, ore: OreType) {
  const cp = myCartPosition()
  if (!cp) return
  const e = engine.addEntity()
  const s = 0.35 / ORE[ore].modelSize
  Transform.create(e, { position: from, scale: Vector3.create(s, s, s) })
  GltfContainer.create(e, { src: ORE[ore].model, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  Tween.create(e, { mode: Tween.Mode.Move({ start: from, end: Vector3.create(cp.x, cp.y + 0.5, cp.z) }), duration: 600, easingFunction: EasingFunction.EF_EASEINQUAD })
  flying.push({ entity: e, removeAt: Date.now() + 620 })
}

const flying: { entity: Entity; removeAt: number }[] = []

function onFace(msg: FaceMsg) {
  if (msg.room !== ui.inRoom) return
  const cells = roomCells[msg.room - 1] ?? []
  if (msg.event === 'new') return applyFace(msg)
  const c = cells[msg.rock]
  if (msg.event === 'slide') {
    // last rock bursts, then the face slides back and a new one rolls in 10 m deeper
    if (c) dropCell(msg.room, c)
    slide = { room: msg.room, t: -1.2, pending: msg } // let the last rock land, then the new face pops in
    return
  }
  if (!c) return
  c.hp = msg.hp[msg.rock]
  if (msg.event === 'burst') dropCell(msg.room, c)
}

function faceSystem(dt: number) {
  const now = Date.now()
  for (let i = flying.length - 1; i >= 0; i--) {
    if (now >= flying[i].removeAt) {
      engine.removeEntity(flying[i].entity)
      playSfx(CONFIG.collectSound, CONFIG.collectVolume)
      flying.splice(i, 1)
    }
  }
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i]
    f.t += dt
    const c = f.cell
    if (!c.fallen) {
      falling.splice(i, 1)
      continue
    }
    const out = Math.min(1, f.t / POP_SECONDS)
    const tf = Math.max(0, f.t - POP_SECONDS)
    let landed = true
    for (const p of [c.cube, ...c.ores]) {
      const y = Math.max(f.floor, p.pos.y - 0.5 * GRAVITY_LOCAL * tf * tf)
      if (y > f.floor) landed = false
      const tr = Transform.getMutable(p.entity)
      tr.position = Vector3.create(p.pos.x, y, p.pos.z + POP_OUT * out)
      tr.rotation = Quaternion.multiply(p.rot, Quaternion.fromEulerDegrees(tf * 260 * f.spin, 0, tf * 120 * f.spin))
    }
    // rest on the floor briefly, then hide it back in its slot (still clickable as part of the face)
    if (landed && f.t > POP_SECONDS + CONFIG.faceFallHide) {
      showCell(c, false)
      falling.splice(i, 1)
    }
  }
  // face cleared: the wall stays put; once the last rock has landed, the next face (10 m deeper) pops in
  if (!slide) return
  slide.t += dt
  if (slide.t < 0) return
  const msg = slide.pending
  slide = null
  if (!msg || msg.room !== ui.inRoom) return
  applyFace(msg)
  for (const c of roomCells[msg.room - 1] ?? []) {
    if (c.fallen) continue
    for (const p of [c.cube, ...c.ores]) {
      Tween.createOrReplace(p.entity, { mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: p.scale }), duration: 450, easingFunction: EasingFunction.EF_EASEOUTBACK })
    }
  }
  dustPuff(faceMarker() ?? Vector3.Zero())
  showBanner(`DEPTH ${msg.depth} m`)
}

function faceMarker(): Vector3 | null {
  const cells = roomCells[ui.inRoom - 1] ?? []
  const c = cells.find((x) => !x.fallen)
  return c ? Vector3.add(worldTransform(c.cube.entity).position, Vector3.create(0, 1.4, 0)) : null
}

// ---------- open seam (yard) ----------

// The seam is the fallback from the V0 doc: it only appears (and only works) while every claim room is taken.
const seamViews = new Map<Entity, { visual: Entity; ore: string; alive: boolean; hp: number; shown: boolean }>()

function rockScale(f: { ore: OreType; hp: number; maxHp: number }, size: number): Vector3 {
  const s = (size / ORE[f.ore].modelSize) * (0.55 + (0.45 * Math.max(0, f.hp)) / Math.max(1, f.maxHp))
  return Vector3.create(s, s, s)
}

function seamOpen(): boolean {
  const r = rooms()
  return !CONFIG.seamOnlyWhenFull || (!!r && r.owners.length > 0 && r.owners.every((o) => o !== ''))
}

function seamSystem() {
  const open = seamOpen()
  for (const [e, r] of engine.getEntitiesWith(SeamRock, Transform)) {
    let v = seamViews.get(e)
    if (!v) {
      const visual = engine.addEntity()
      Transform.create(visual, { parent: e })
      v = { visual, ore: '', alive: !r.alive, hp: -1, shown: !open }
      seamViews.set(e, v)
      const index = r.index
      pointerEventsSystem.onPointerDown(
        { entity: visual, opts: { button: InputAction.IA_POINTER, hoverText: 'Mine (open seam)', maxDistance: CONFIG.mineReach } },
        () => hitSeam(index, visual)
      )
    }
    const ore = r.ore as OreType
    if (v.ore !== r.ore) {
      v.ore = r.ore
      const src = ORE[ore].model
      if (src) GltfContainer.createOrReplace(v.visual, { src, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER, invisibleMeshesCollisionMask: 0 })
    }
    if (v.alive !== r.alive || v.hp !== r.hp || v.shown !== open) {
      v.shown = open
      if (v.alive && !r.alive) playSfx(CONFIG.breakSound, CONFIG.breakVolume * 0.6)
      v.alive = r.alive
      v.hp = r.hp
      VisibilityComponent.createOrReplace(v.visual, { visible: r.alive && open })
      const g = GltfContainer.getMutableOrNull(v.visual)
      if (g) g.visibleMeshesCollisionMask = r.alive && open ? ColliderLayer.CL_POINTER : 0
      Transform.getMutable(v.visual).scale = rockScale({ ore, hp: r.hp, maxHp: r.maxHp }, CONFIG.seamRockSize)
      Transform.getMutable(v.visual).position = Vector3.create(0, 0.4, 0)
    }
  }
  for (const [e, v] of seamViews) {
    if (SeamRock.has(e)) continue
    engine.removeEntity(v.visual)
    seamViews.delete(e)
  }
}

function hitSeam(index: number, visual: Entity) {
  const d = me()
  if (!d) return
  if (!d.hasCart) return showToast('Take a cart from the dock first!', true)
  if (cartFull()) return showToast('Cart full! Bank it at the vault.', true)
  if (!swing()) return
  shake(visual, Transform.get(visual).scale)
  void room.send('hit', { rock: 100 + index })
}

// ---------- spilled piles ----------

const pileViews = new Map<Entity, Entity>()

function pileSystem() {
  for (const [e, p] of engine.getEntitiesWith(Pile, Transform)) {
    if (pileViews.has(e)) continue
    const v = engine.addEntity()
    Transform.create(v, { parent: e, position: Vector3.create(0, 0.2, 0), scale: Vector3.create(1.2, 0.4, 1.2) })
    MeshRenderer.setCylinder(v)
    MeshCollider.setCylinder(v, ColliderLayer.CL_POINTER)
    Material.setPbrMaterial(v, {
      albedoColor: Color4.create(1, 0.8, 0.2, 1),
      emissiveColor: Color3.create(1, 0.75, 0.15),
      emissiveIntensity: 2.5,
      castShadows: false
    })
    const id = p.id
    pointerEventsSystem.onPointerDown(
      { entity: v, opts: { button: InputAction.IA_POINTER, hoverText: 'Collect spilled ore', maxDistance: CONFIG.pileCollectRange + 2 } },
      () => {
        if (!me()?.hasCart) return showToast('You need a cart to collect ore.', true)
        void room.send('collectPile', { id })
      }
    )
    pileViews.set(e, v)
  }
  for (const [e, v] of pileViews) {
    if (Pile.has(e)) continue
    engine.removeEntity(v)
    pileViews.delete(e)
  }
}

// ---------- stealing (the server checks every rule) ----------

// A rival running into my cart steals ore: my screen decides the touch, the server checks every rule.
const lastBump = new Map<string, number>()
function playerContactSystem() {
  const d = me()
  if (!d || !d.hasCart || ui.inRoom > 0 || cartTons() < CONFIG.rookieTons) return
  const mine = myCartPosition()
  if (!mine) return
  const id = myId()
  const now = Date.now()
  for (const [, o] of engine.getEntitiesWith(Miner)) {
    if (o.address === id || !o.hasCart || o.room > 0) continue
    const avatar = avatarOf(o.address)
    const ap = avatar ? Transform.getOrNull(avatar)?.position : null
    const v = carts.get(o.address)
    const cp = v ? Transform.get(v.cart).position : null
    const dist = Math.min(ap ? flatDist(ap, mine) : Infinity, cp ? flatDist(cp, mine) : Infinity)
    if (dist > CONFIG.playerTouch) continue
    if (now - (lastBump.get(o.address) ?? 0) < CONFIG.grabCooldown * 1000) continue
    lastBump.set(o.address, now)
    void room.send('playerContact', { thief: o.address })
  }
}

/** How far I am from a rival's cart as my screen shows it. */
function distToCart(address: string): number {
  const v = carts.get(address)
  const p = playerPos()
  return v && p ? flatDist(p, Transform.get(v.cart).position) : Infinity
}

function grabCart(victim: string) {
  const d = me()
  if (!d || !d.hasCart) return showToast('You need a cart to carry stolen ore.', true)
  if (distToCart(victim) > CONFIG.grabRange + 0.6) return showToast('Get right up to their cart to grab!')
  void room.send('grab', { victim })
}

function ramCart(victim: string) {
  const d = me()
  if (!d || !d.hasCart) return showToast('You need a cart to ram.', true)
  if (distToCart(victim) > CONFIG.ramRange + 0.6) return showToast('Get right up against their cart to ram!')
  void room.send('ram', { victim })
}

// ---------- vault and forge ----------

export function deposit() {
  if (cartTons() <= 0.01) return showToast('Your cart is empty. Go dig!', true)
  void room.send('deposit', { ok: true })
}

export function buy(kind: 'pickaxe' | 'cart' | 'boots') {
  void room.send('buy', { kind })
}

export function openForgeFromVault() {
  ui.forgeFromVault = true
}

export function playerNearVault(): boolean {
  const p = playerPos()
  return !!p && !!vault && flatDist(p, pos(vault)) < CONFIG.safeZoneRadius
}

function panelSystem() {
  const p = playerPos()
  if (!p || ui.inRoom > 0) {
    ui.panel = 'none'
    return
  }
  const nearVault = !!vault && flatDist(p, pos(vault)) < CONFIG.vaultRadius
  if (!nearVault) ui.forgeFromVault = false
  if (nearVault) ui.panel = ui.forgeFromVault ? 'forge' : 'vault'
  else if ((forge && flatDist(p, pos(forge)) < CONFIG.storeRadius) || (cartShop && flatDist(p, pos(cartShop)) < CONFIG.storeRadius)) ui.panel = 'forge'
  else if (tunnelPad && flatDist(p, pos(tunnelPad)) < CONFIG.claimPadRadius) ui.panel = 'rooms'
  else ui.panel = 'none'
  if (ui.panel === 'forge' && ui.tutorial === 'upgrade') completeTutorial('upgrade')
}

// ---------- server messages ----------

function setupMessages() {
  room.onMessage('notify', (m) => showToast(m.text, m.danger))
  // a bandit tackled us: knocked back away from it
  room.onMessage('tackle', (m) => {
    Physics.applyKnockbackToPlayer(Vector3.create(m.x, 0.5, m.z), CONFIG.banditTackleForce)
    playSfx(CONFIG.hitSound, CONFIG.hitVolume)
  })
  room.onMessage('banner', (m) => showBanner(m.text))
  room.onMessage('roomGranted', (m) => enterRoom(m.room))
  room.onMessage('roomEnded', (m) => {
    if (ui.inRoom > 0) exitRoom(m.reason) // already handled locally if we walked out
  })
  room.onMessage('face', (m) => onFace(m))
  room.onMessage('swing', () => {
    playSfx(CONFIG.hitSound, CONFIG.hitVolume)
    swungOnce = true
  })
  room.onMessage('deposited', () => {
    playSfx(CONFIG.buySound, CONFIG.buyVolume)
    depositedOnce = true
  })
}

let helloAt = 0
let tutorialChecked = false
let lastTutorialStep: TutorialStep = 'meetDusty'
let swungOnce = false
let depositedOnce = false

/** Replays the tutorial from the start (it begins with Foreman Dusty). */
export function restartTutorial() {
  swungOnce = false
  depositedOnce = false
  ui.tutorial = 'meetDusty'
}

/** Each step follows what the player is actually doing, so it can never get stuck on a skipped action. */
function updateTutorial(hasCart: boolean) {
  const t = ui.tutorial
  if (t === 'welcome' || t === 'meetDusty' || t === 'upgrade' || t === 'done') return
  let step: TutorialStep
  if (depositedOnce) step = 'upgrade'
  else if (!hasCart) step = 'takeCart'
  else if (ui.inRoom > 0) step = cartFull() ? (ui.cartTaken ? 'exitMine' : 'takeFullCart') : swungOnce ? 'fillCart' : 'mineRock'
  else if (cartTons() > 0.01) step = ui.panel === 'vault' ? 'deposit' : 'runToVault'
  else step = 'enterTunnel'
  ui.tutorial = step
}
let posTimer = 0
let hadCart = false
let lastLevels = ''

function syncSystem(dt: number) {
  heartbeatSystem()
  swingCooldown = Math.max(0, swingCooldown - dt)
  if (ui.toast.timeLeft > 0) ui.toast.timeLeft -= dt
  if (ui.banner.timeLeft > 0) ui.banner.timeLeft -= dt
  const id = myId()
  const raw = id ? engine.getEntitiesWith(Miner) : null
  let mine = null
  if (raw) for (const [, d] of raw) if (d.address === id) mine = d
  // tell the server our display name
  if (mine && mine.name !== myDisplayName().slice(0, 24) && Date.now() - helloAt > 3000) {
    helloAt = Date.now()
    void room.send('hello', { name: myDisplayName().slice(0, 24) })
  }
  // position report: the server only uses it if it has no transform of its own for us
  posTimer += dt
  const pt = Transform.getOrNull(engine.PlayerEntity)
  if (mine && pt && posTimer >= CONFIG.positionReportSeconds) {
    posTimer = 0
    const f = Vector3.rotate(Vector3.Forward(), pt.rotation)
    void room.send('pos', { x: pt.position.x, z: pt.position.z, yaw: (Math.atan2(f.x, f.z) * 180) / Math.PI })
  }
  const d = me()
  if (!d) return
  // returning players skip the tutorial (checked once, so the Tutorial button can replay it)
  if (!tutorialChecked) {
    tutorialChecked = true
    if (d.tutorialDone) ui.tutorial = 'done'
  }
  updateTutorial(d.hasCart)
  if (ui.tutorial === 'done' && !d.tutorialDone && !ui.tutorialSent) {
    ui.tutorialSent = true
    void room.send('tutorialDone', { ok: true })
  }
  if (d.hasCart && !hadCart) {
    completeTutorial('takeCart')
  }
  hadCart = d.hasCart
  // the server ended our claim while we were not listening (e.g. after a reconnect)
  if (ui.inRoom > 0 && d.room === 0 && !slide && Date.now() - ui.roomSince > 4000) exitRoom('')
  // celebrate the end of the tutorial (not when it was skipped)
  if (lastTutorialStep === 'upgrade' && ui.tutorial === 'done') showBanner('Tutorial complete! Mine, haul, bank, upgrade.')
  lastTutorialStep = ui.tutorial
  const levels = `${d.pickaxe}${d.cart}${d.boots}`
  if (lastLevels && levels !== lastLevels) {
    playSfx(CONFIG.buySound, CONFIG.buyVolume)
    completeTutorial('upgrade')
  }
  lastLevels = levels
}

// ---------- tutorial marker ----------

function markerTarget(): Vector3 | null {
  switch (ui.tutorial) {
    case 'meetDusty': {
      const d = npcPosition('dusty-0001')
      return d ? Vector3.add(d, Vector3.create(0, 2.8, 0)) : null
    }
    case 'takeCart':
      if (me()?.hasCart) return null
      return nearestDock() ? Vector3.add(nearestDock()!, Vector3.create(0, 2.5, 0)) : null
    case 'enterTunnel':
      return tunnelPad && ui.inRoom === 0 ? Vector3.add(pos(tunnelPad), Vector3.create(0, 2.5, 0)) : null
    case 'mineRock':
    case 'fillCart': {
      return ui.inRoom > 0 ? faceMarker() : null
    }
    case 'takeFullCart': {
      const c = myCartPosition()
      return ui.inRoom > 0 && c ? Vector3.add(c, Vector3.create(0, 1.8, 0)) : null
    }
    case 'deposit':
    case 'runToVault': {
      if (ui.inRoom > 0) return null
      const clerk = npcPosition('clerk-0001')
      return clerk ? Vector3.add(clerk, Vector3.create(0, 2.8, 0)) : vault ? Vector3.add(pos(vault), Vector3.create(0, 7, 0)) : null
    }
    case 'upgrade': {
      const smith = npcPosition('ironjaw-0001')
      return smith ? Vector3.add(smith, Vector3.create(0, 2.8, 0)) : forge ? Vector3.add(pos(forge), Vector3.create(0, 6, 0)) : null
    }
    default:
      return null
  }
}

// ---------- collisions ----------

function applyCollisions() {
  const skip = new Set(CONFIG.noCollision)
  for (const [entity] of engine.getEntitiesWith(GltfContainer)) {
    const name = Name.getOrNull(entity)?.value ?? ''
    if (skip.has(name)) continue
    GltfContainer.getMutable(entity).visibleMeshesCollisionMask = ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  }
}

// ---------- setup ----------

export function setupGame() {
  applyCollisions()
  setupDocks()
  vault = byName(NAMES.vault)
  forge = byName(NAMES.forge)
  cartShop = byName(NAMES.cartShop)
  tunnelPad = byName(NAMES.tunnelPad)
  returnPad = byName(NAMES.returnPad)
  for (const n of NAMES.roomPads) roomPads.push(byName(n))
  for (const n of NAMES.roomWalls) {
    const w = byName(n)
    walls.push(w)
    wallStart.push(w ? Vector3.clone(Transform.get(w).position) : null)
  }
  // each wall's 3x3 cubes + crystals are the ore face; its Rock_Stroke box is the (invisible) click area
  setupCells(NAMES.roomStrokes.map((n) => byName(n)))
  for (const e of [tunnelPad, returnPad, ...roomPads]) if (e) VisibilityComponent.createOrReplace(e, { visible: false })
  // Bandit Spawn1-3 are markers placed in the Creator Hub: invisible and walk-through in play
  for (const n of NAMES.banditSpawns) {
    const e = engine.getEntityOrNullByName(n)
    if (e) hide(e)
  }

  // old ore template props (beanbag/gem placeholders) are not used any more
  for (const n of CONFIG.oreTemplateNames) {
    const e = engine.getEntityOrNullByName(n)
    if (e) hide(e)
  }

  setupSideLabel()
  setupRoomSigns()
  setupMessages()
  setupBandits()
  setupGuide(markerTarget)
  engine.addSystem(syncSystem)
  engine.addSystem(cartSystem)
  engine.addSystem(sideLabelSystem)
  engine.addSystem(runLimitSystem)
  engine.addSystem(axeVisibilitySystem)
  engine.addSystem(unequipSystem)
  engine.addSystem(takeCartKeySystem)
  engine.addSystem(playerContactSystem)
  engine.addSystem(roomSystem)
  engine.addSystem(faceSystem)
  engine.addSystem(seamSystem)
  engine.addSystem(pileSystem)
  engine.addSystem(panelSystem)
}

