// Tutorial guide: a trail of arrows that flows along the ground from the player to the current target,
// plus a big bobbing arrow above the target pointing down at it.
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  Billboard,
  BillboardMode,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CONFIG } from './config'

const ARROW_TEXTURE = Material.Texture.Common({ src: CONFIG.arrowImage })
const FLAT = Quaternion.fromEulerDegrees(90, 0, 0) // lay the plane flat on the ground

const trail: Entity[] = []
let markerRoot: Entity | null = null
let markerArrow: Entity | null = null
let flow = 0
let time = 0
let getTarget: () => Vector3 | null = () => null

// PBR + explicit blend mode is what makes the PNG's own transparency work (the basic material draws it black)
function setArrowMaterial(e: Entity, alpha: number) {
  Material.setPbrMaterial(e, {
    texture: ARROW_TEXTURE,
    emissiveTexture: ARROW_TEXTURE,
    emissiveColor: Color3.White(),
    emissiveIntensity: 0.6,
    albedoColor: Color4.create(1, 1, 1, alpha),
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })
}

/** `target` returns the point above the current objective (or null to hide the guide). */
export function setupGuide(target: () => Vector3 | null) {
  getTarget = target
  for (let i = 0; i < CONFIG.arrowTrailCount; i++) {
    const e = engine.addEntity()
    Transform.create(e, { scale: Vector3.create(CONFIG.arrowTrailSize, CONFIG.arrowTrailSize, 1) })
    MeshRenderer.setPlane(e)
    setArrowMaterial(e, 1)
    VisibilityComponent.create(e, { visible: false })
    trail.push(e)
  }

  // Marker above the target: the parent turns to face the camera, the child is rolled to point down
  markerRoot = engine.addEntity()
  Transform.create(markerRoot, {})
  Billboard.create(markerRoot, { billboardMode: BillboardMode.BM_Y })
  markerArrow = engine.addEntity()
  Transform.create(markerArrow, {
    parent: markerRoot,
    rotation: Quaternion.fromEulerDegrees(0, 0, CONFIG.arrowMarkerRoll),
    scale: Vector3.create(CONFIG.arrowMarkerSize, CONFIG.arrowMarkerSize, 1)
  })
  MeshRenderer.setPlane(markerArrow)
  setArrowMaterial(markerArrow, 1)
  VisibilityComponent.create(markerArrow, { visible: false })

  engine.addSystem(guideSystem)
}

function hideAll() {
  for (const e of trail) VisibilityComponent.getMutable(e).visible = false
  if (markerArrow) VisibilityComponent.getMutable(markerArrow).visible = false
}

function guideSystem(dt: number) {
  time += dt
  const target = getTarget()
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!target || !player) return hideAll()

  // ----- marker above the target -----
  if (markerRoot && markerArrow) {
    VisibilityComponent.getMutable(markerArrow).visible = true
    Transform.getMutable(markerRoot).position = Vector3.create(target.x, target.y + Math.sin(time * 3) * 0.3, target.z)
  }

  // ----- flowing trail on the ground -----
  const dx = target.x - player.x
  const dz = target.z - player.z
  const dist = Math.hypot(dx, dz)
  const start = CONFIG.arrowTrailStart
  const end = dist - CONFIG.arrowTrailStopShort
  const length = end - start
  if (length < CONFIG.arrowTrailSpacing * 0.5) {
    for (const e of trail) VisibilityComponent.getMutable(e).visible = false
    return
  }
  const dirX = dx / dist
  const dirZ = dz / dist
  const heading = (Math.atan2(dirX, dirZ) * 180) / Math.PI
  const rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, heading + CONFIG.arrowYawOffset, 0), FLAT)

  // arrows slide forward continuously; a new one fades in at the start as the front one fades out
  const spacing = CONFIG.arrowTrailSpacing
  flow = (flow + dt * CONFIG.arrowFlowSpeed) % spacing
  const visibleLength = Math.min(length, spacing * trail.length)
  trail.forEach((e, i) => {
    const along = i * spacing + flow
    if (along > visibleLength) {
      VisibilityComponent.getMutable(e).visible = false
      return
    }
    const fadeIn = Math.min(1, along / (spacing * 0.8))
    const fadeOut = Math.min(1, (visibleLength - along) / (spacing * 0.8))
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut))
    const d = start + along
    VisibilityComponent.getMutable(e).visible = alpha > 0.02
    const t = Transform.getMutable(e)
    t.position = Vector3.create(player.x + dirX * d, CONFIG.groundY + 0.06, player.z + dirZ * d)
    t.rotation = rotation
    setArrowMaterial(e, alpha)
  })
}
