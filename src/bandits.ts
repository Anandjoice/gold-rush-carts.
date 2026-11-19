// Bandit NPCs: the server moves them (synced Transform); each client dresses them as avatars and
// lets players tap one to scare it off (costs stamina, checked by the server).
import { engine, Entity, Transform, AvatarShape, MeshCollider, ColliderLayer, pointerEventsSystem, InputAction, TextShape, Billboard } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { CONFIG } from './config'
import { Bandit, room } from './shared'
import { myCartPosition } from './game'
import { cartTons, me, ui } from './state'

const BASE = 'urn:decentraland:off-chain:base-avatars:'
const OUTFITS = [
  [`${BASE}red_tshirt`, `${BASE}brown_pants`],
  [`${BASE}black_jacket`, `${BASE}brown_pants`],
  [`${BASE}green_square_shirt`, `${BASE}brown_pants`]
]

const views = new Map<Entity, { body: Entity; hit: Entity; tag: Entity }>()

function banditViewSystem() {
  for (const [e, b] of engine.getEntitiesWith(Bandit, Transform)) {
    if (views.has(e)) continue
    const body = engine.addEntity()
    Transform.create(body, { parent: e })
    AvatarShape.create(body, {
      id: `bandit-${(1000 + b.id).toString()}`,
      name: 'Bandit',
      bodyShape: `${BASE}BaseMale`,
      wearables: [`${BASE}eyebrows_00`, `${BASE}mouth_00`, `${BASE}eyes_00`, `${BASE}classic_shoes`, `${BASE}short_hair`, ...OUTFITS[b.id % OUTFITS.length]],
      hairColor: { r: 0.1, g: 0.08, b: 0.05 },
      skinColor: { r: 0.8, g: 0.62, b: 0.45 },
      emotes: []
    })
    // avatars cannot be clicked directly: an invisible box does it
    const hit = engine.addEntity()
    Transform.create(hit, { parent: e, position: Vector3.create(0, 0.95, 0), scale: Vector3.create(0.9, 1.9, 0.9) })
    MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
    const id = b.id
    pointerEventsSystem.onPointerDown(
      { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: `Scare the bandit off (${CONFIG.staminaScare} stamina)`, maxDistance: CONFIG.banditScareRange } },
      () => void room.send('scareBandit', { id })
    )
    // a red tag over the head, so a bandit is always easy to spot (even where avatars are culled)
    const tag = engine.addEntity()
    Transform.create(tag, { parent: e, position: Vector3.create(0, 2.45, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
    TextShape.create(tag, { text: 'BANDIT', fontSize: 3, textColor: Color4.create(1, 0.25, 0.2, 1), outlineWidth: 0.3, outlineColor: Color3.Black(), fontSrc: 'assets/fonts/LilitaOne-Regular.ttf' })
    Billboard.create(tag)
    views.set(e, { body, hit, tag })
  }
  for (const [e, v] of views) {
    if (Bandit.has(e)) continue
    engine.removeEntity(v.body)
    engine.removeEntity(v.hit)
    engine.removeEntity(v.tag)
    views.delete(e)
  }
}

// A steal needs a real touch: when a bandit reaches my cart (or me) ON MY SCREEN, tell the server.
const lastContact = new Map<number, number>()
function banditContactSystem() {
  const d = me()
  if (!d || !d.hasCart || ui.inRoom > 0 || cartTons() < CONFIG.rookieTons) return
  const cart = myCartPosition()
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const now = Date.now()
  for (const [, b, t] of engine.getEntitiesWith(Bandit, Transform)) {
    const bp = t.position
    const dc = cart ? Math.hypot(bp.x - cart.x, bp.z - cart.z) : Infinity
    const dp = player ? Math.hypot(bp.x - player.x, bp.z - player.z) : Infinity
    if (Math.min(dc, dp) > CONFIG.banditTouch) continue
    if (now - (lastContact.get(b.id) ?? 0) < 1000) continue
    lastContact.set(b.id, now)
    void room.send('banditContact', { id: b.id })
  }
}

export function setupBandits() {
  engine.addSystem(banditViewSystem)
  engine.addSystem(banditContactSystem)
}
