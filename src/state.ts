// Client-side state: UI flags, the tutorial, toasts, and read-only views of what the server synced.
import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { CONFIG } from './config'
import { capacityOf, Heartbeat, loadOf, loadShare, Miner, MinerData, Rooms, Stamina, tonsOf, World } from './shared'

export type Panel = 'none' | 'vault' | 'forge' | 'rooms'

export type TutorialStep =
  | 'welcome'
  | 'meetDusty'
  | 'takeCart'
  | 'enterTunnel'
  | 'mineRock'
  | 'fillCart'
  | 'takeFullCart'
  | 'exitMine'
  | 'runToVault'
  | 'deposit'
  | 'upgrade'
  | 'done'

/** The tutorial, in order: a short title for the step board and one clear instruction. */
export const TUTORIAL: Record<TutorialStep, { title: string; text: string }> = {
  welcome: { title: '', text: '' },
  meetDusty: { title: 'Meet Foreman Dusty', text: 'Follow the arrows and talk to Foreman Dusty.' },
  takeCart: { title: 'Get a cart', text: 'Walk to the Cart Dock and press E on a cart (or tap Equip Cart).' },
  enterTunnel: { title: 'Claim a room', text: 'Go to the Tunnel 1 entrance and claim a free room on the board.' },
  mineRock: { title: 'Swing your pickaxe', text: 'Click the rock wall to mine. Ore drops straight into your cart.' },
  fillCart: { title: 'Fill your cart', text: 'Keep mining until your cart is full.' },
  takeFullCart: { title: 'Take your cart', text: 'Your cart is full! Tap TAKE CART (or press E).' },
  exitMine: { title: 'Leave the mine', text: 'Click EXIT. You leave the mine with your cart.' },
  runToVault: { title: 'Haul it home', text: 'Push your cart to Mae at the Vault. Watch out for bandits and rivals!' },
  deposit: { title: 'Deposit', text: 'Tap DEPOSIT to turn your ore into coins.' },
  upgrade: { title: 'Upgrade', text: "Visit Ironjaw's Forge to see what your coins can buy." },
  done: { title: '', text: '' }
}

/** The numbered steps shown on the tutorial board. */
export const TUTORIAL_STEPS: TutorialStep[] = ['meetDusty', 'takeCart', 'enterTunnel', 'mineRock', 'fillCart', 'takeFullCart', 'exitMine', 'runToVault', 'deposit', 'upgrade']

export const ui = {
  panel: 'none' as Panel,
  forgeFromVault: false, // "Upgrades" pressed at the vault
  tutorial: 'meetDusty' as TutorialStep, // the tutorial starts by talking to Foreman Dusty
  tutorialSent: false,
  toast: { text: '', danger: false, timeLeft: 0 },
  banner: { text: '', timeLeft: 0 },
  questsOpen: true,
  mobile: false, // set once the Explorer reports its platform: compact UI on phones
  menuMin: false, // the open station menu (Deposit / Forge / claim board) is folded to a small tab
  hudMore: false, // mobile: extra HUD rows (levels, music, tutorial) shown
  inRoom: 0, // room this client is standing in (from the server's grant)
  roomSince: 0, // when the grant arrived
  cartTaken: false, // in a room: the player took the (full) cart back with E, so EXIT is offered
  depthShown: 0,
  axeTune: { ...CONFIG.axeGrip },
  dialog: null as null | { name: string; lines: string[]; index: number; portrait: string }
}

// ---------- identity ----------

let myAddress = ''
let myName = ''

export function myId(): string {
  if (!myAddress) {
    const p = getPlayer()
    if (p?.userId) {
      myAddress = p.userId.toLowerCase()
      myName = p.name || 'Miner'
    }
  }
  return myAddress
}

export function myDisplayName(): string {
  myId()
  return myName || 'Miner'
}

// ---------- synced data ----------

export function minerOf(address: string): MinerData | null {
  for (const [, d] of engine.getEntitiesWith(Miner)) if (d.address === address) return d
  return null
}

/** My own server record, or null until the server has created and loaded it. */
export function me(): MinerData | null {
  const id = myId()
  if (!id) return null
  const d = minerOf(id)
  return d && d.loaded ? d : null
}

export function myStamina(): { value: number; max: number; tired: boolean } {
  const id = myId()
  for (const [, s] of engine.getEntitiesWith(Stamina)) if (s.address === id) return s
  return { value: 100, max: 100, tired: false }
}

export function world() {
  for (const [, w] of engine.getEntitiesWith(World)) return w
  return null
}

export function rooms() {
  for (const [, r] of engine.getEntitiesWith(Rooms)) return r
  return null
}

export function cartTons(): number {
  const d = me()
  return d ? tonsOf(loadOf(d)) : 0
}

export function cartCap(): number {
  const d = me()
  return d ? capacityOf(d) : 20
}

/** Share of the cart that is full, 0..1. */
export function cartShare(): number {
  const d = me()
  return d ? loadShare(d) : 0
}

/** Speed lost to cart weight right now, 0..CONFIG.loadSlowdownMax. */
export function slowdown(): number {
  return Math.round(cartShare() * CONFIG.loadSlowdownMax * 20) / 20 // in 5% steps
}

/** Loaded enough that it is time to haul it home (tutorial, room bar). */
export function loaded(): boolean {
  return cartShare() >= CONFIG.loadedAt
}

export function cartFull(): boolean {
  return cartTons() >= cartCap() - 0.01
}

// ---------- server clock and liveness ----------

let lastBeat = 0
let lastBeatSeenAt = 0
let clockOffset = 0

/** Call every frame: tracks the heartbeat (client-observed time) and the server clock offset. */
export function heartbeatSystem() {
  for (const [, h] of engine.getEntitiesWith(Heartbeat)) {
    if (h.at !== lastBeat) {
      lastBeat = h.at
      lastBeatSeenAt = Date.now()
      clockOffset = h.at - Date.now()
    }
    break
  }
}

export function serverNow(): number {
  return Date.now() + clockOffset
}

export function serverAlive(): boolean {
  return isStateSyncronized() && lastBeatSeenAt > 0 && Date.now() - lastBeatSeenAt < 7000
}

// ---------- toasts, banners, tutorial ----------

export function showToast(text: string, danger = false) {
  ui.toast = { text, danger, timeLeft: CONFIG.toastSeconds }
}

export function showBanner(text: string) {
  ui.banner = { text, timeLeft: CONFIG.bannerSeconds }
}

const ORDER: TutorialStep[] = ['welcome', ...TUTORIAL_STEPS, 'done']

/** Moves the tutorial forward to `step` (never backwards). */
export function reachTutorial(step: TutorialStep) {
  if (ORDER.indexOf(step) > ORDER.indexOf(ui.tutorial)) ui.tutorial = step
}

/** Marks `step` as done and moves to the following step. */
export function completeTutorial(step: TutorialStep) {
  if (ui.tutorial !== step) return
  ui.tutorial = ORDER[ORDER.indexOf(step) + 1]
}
