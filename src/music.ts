// Background music: one looping, non-spatial track for the whole scene.
import { engine, Transform, AudioSource } from '@dcl/sdk/ecs'
import { CONFIG } from './config'

let music: ReturnType<typeof engine.addEntity> | null = null

export function setupMusic() {
  music = engine.addEntity()
  Transform.create(music) // an AudioSource only plays on an entity that has a Transform
  AudioSource.create(music, {
    audioClipUrl: CONFIG.musicFile,
    playing: true,
    loop: true,
    volume: CONFIG.musicVolume,
    global: true // same volume everywhere in the scene
  })
}

/** Turns the music on or off; returns the new state. */
export function toggleMusic(): boolean {
  if (!music) return false
  const a = AudioSource.getMutable(music)
  a.playing = !a.playing
  return a.playing
}

export function musicOn(): boolean {
  return !!music && !!AudioSource.getOrNull(music)?.playing
}

// ---------- sound effects ----------
// Played on the player's camera so they are always heard at full volume, only by this player.
// One entity per sound, so a hit and a break can play at the same moment without cutting each other off.
const sfx = new Map<string, ReturnType<typeof engine.addEntity>>()

export function playSfx(file: string, volume = 1) {
  let e = sfx.get(file)
  if (!e) {
    e = engine.addEntity()
    Transform.create(e, { parent: engine.CameraEntity })
    sfx.set(file, e)
  }
  // replacing the component restarts the clip from the beginning, even if it is still playing
  AudioSource.createOrReplace(e, { audioClipUrl: file, playing: true, loop: false, volume, global: true, currentTime: 0 })
}
