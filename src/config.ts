// All tuning numbers for Gold Rush Carts live here (V0 prototype document), so balance changes need no code edits.
// Shared by the client and the Multiplayer Server.

export type OreType = 'copper' | 'silver' | 'gold' | 'gem'

export const ORE_TYPES: OreType[] = ['copper', 'silver', 'gold', 'gem']

// value = coins per ton, tons = tons a rock gives when it bursts, hp = hits at damage 1,
// respawn = seconds before an open-seam rock grows back, needs = pickaxe level required.
// model = the ore crystal GLB used on the face, in carts and in the seam; modelSize = its largest side at scale 1.
// Gold and gem are only reached from 60 m / 100 m down (V1 depth table, already wired in).
export const ORE = {
  copper: { label: 'Copper', value: 1, tons: 4, hp: 4, respawn: 20, needs: 1, color: { r: 0.85, g: 0.5, b: 0.25, a: 1 }, model: 'assets/Models/Copper_Ore/Copper_Ore.glb', modelSize: 0.96 },
  silver: { label: 'Silver', value: 3, tons: 4, hp: 6, respawn: 35, needs: 2, color: { r: 0.75, g: 0.8, b: 0.9, a: 1 }, model: 'assets/Models/Silver_Ore/Silver_Ore.glb', modelSize: 0.96 },
  gold: { label: 'Gold', value: 8, tons: 4, hp: 8, respawn: 50, needs: 3, color: { r: 1, g: 0.8, b: 0.15, a: 1 }, model: 'assets/Models/GOLD_Ore/GOLD_Ore.glb', modelSize: 0.96 },
  gem: { label: 'Gem', value: 25, tons: 2, hp: 10, respawn: 80, needs: 4, color: { r: 0.9, g: 0.3, b: 0.9, a: 1 }, model: 'assets/Models/Special_Gem/Special_Gem.glb', modelSize: 0.96 }
} as const

// Upgrade cost to reach Lv2 / 3 / 4 / 5 (index = level - 1; Lv1 is free)
export const UPGRADE_COSTS = [0, 60, 300, 1200, 4000]
export const MAX_LEVEL = 5

export const PICKAXE_DAMAGE = [1, 1.5, 2, 3, 4]
export const CART_CAPACITY = [20, 35, 55, 80, 110]
// Lv4 carts lose 15% less to grabs, Lv5 25% less
export const CART_GRAB_REDUCTION = [0, 0, 0, 0.15, 0.25]
export const BOOTS = [
  { max: 100, regen: 8 },
  { max: 125, regen: 9 },
  { max: 150, regen: 10 },
  { max: 180, regen: 12 },
  { max: 220, regen: 14 }
]

// Ore mix of each 3x3 face by depth (weights). Gem: one rare gem rock per face from 100 m.
export const DEPTH_TABLE = [
  { from: 0, mix: { copper: 1, silver: 0, gold: 0 }, gem: false },
  { from: 30, mix: { copper: 0.6, silver: 0.4, gold: 0 }, gem: false },
  { from: 60, mix: { copper: 0, silver: 0.6, gold: 0.4 }, gem: false },
  { from: 100, mix: { copper: 0, silver: 0, gold: 1 }, gem: true }
]

// UI artwork in assets/Images/ui/. Set `enabled: false` to draw plain shapes instead.
export const UI_IMAGES = {
  enabled: true,
  coin: 'assets/Images/ui/coin.png',
  cart: 'assets/Images/ui/cart.png',
  axe: 'assets/Images/ui/axe.png',
  copper: 'assets/Images/ui/ore_bronze.png',
  silver: 'assets/Images/ui/ore_silver.png',
  gold: 'assets/Images/ui/ore_gold.png',
  gem: 'assets/Images/ui/ore_gem.png',
  panel: 'assets/Images/ui/panel_wood.png',
  panelSmall: 'assets/Images/ui/panel_wood_small.png',
  button: 'assets/Images/ui/button_green_small.png',
  buttonRed: 'assets/Images/ui/button_red_small.png',
  buttonDark: 'assets/Images/ui/button_wood_small.png',
  foreman: 'assets/Images/ui/foreman.png',
  logo: 'assets/Images/ui/logo.png',
  target: 'assets/Images/ui/target.png',
  check: 'assets/Images/ui/check.png',
  bandits: 'assets/Images/ui/bandits_banner.png',
  depthMeter: 'assets/Images/ui/depth_meter.png',
  room1: 'assets/Images/ui/room_1.png',
  room2: 'assets/Images/ui/room_2.png',
  room3: 'assets/Images/ui/room_3.png',
  room4: 'assets/Images/ui/room_4.png',
  digits: 'assets/Images/ui/digit_',
  cartFull: 'assets/Images/ui/cart_full_banner.png', // "CART IS FULL!" banner in the room
  keyE: 'assets/Images/ui/key_e.png', // E key icon in "press E" hints
  boots: 'assets/Images/ui/boots.png', // Boots upgrade
  stamina: 'assets/Images/ui/stamina_icon.png', // stamina bar icon
  equipCart: 'assets/Images/ui/button_equip_cart.png' // HUD "Equip Cart" button
}

export const CONFIG = {
  // ---------- stamina ----------
  staminaHit: 3,
  staminaGrab: 10,
  staminaRam: 40,
  staminaScare: 15,
  regenDelay: 1, // seconds after the last spend before regen starts
  tiredSeconds: 3, // at 0 stamina: no swinging or running for this long
  // Cart weight: the fuller the cart, the slower you move (no HEAVY state any more)
  loadSlowdownMax: 0.35, // speed lost at a full cart: 0.35 = 35% slower (jog 8 -> 5.2 m/s, run 10 -> 6.5 m/s)
  baseJogSpeed: 8, // Explorer defaults
  baseRunSpeed: 10,
  loadedAt: 0.7, // load share at which the tutorial and the room bar say "haul it home"

  // ---------- mining ----------
  swingCooldown: 0.6, // seconds between swings
  faceDepth: 10, // metres per cleared face
  faceSlideSeconds: 1.2, // server: how long the face is locked while the new one appears
  // a burst cell pops off the wall and drops to the floor,
  faceFallHide: 0.9, // then rests there this long before it disappears
  mineReach: 6,

  // ---------- claim rooms ----------
  roomCount: 4, // rooms built in Tunnel 1 (the V0 doc plans 8; the scene has 4)
  roomSeconds: 180,
  roomRadius: 9, // a player this close to a room's spawn pad counts as inside it
  claimPadRadius: 1.8, // standing this close to the tunnel pad opens the claim board (the exit pad is 2.25 m away)
  seamOnlyWhenFull: true, // the open seam in the yard is the fallback when every room is taken
  seamOrigin: { x: 44, z: 113 }, // centre of the 3x3 open seam in the tunnel yard (adjust to your layout)
  seamSpacing: 2.2,
  seamRockSize: 1.3,

  // ---------- stealing ----------
  grabTons: 3,
  grabRange: 1.5, // metres: you must be right at the rival's cart to grab
  playerTouch: 1.3, // metres: a rival running into your cart (as your screen shows it) grabs ore
  playerTouchServer: 3.5, // the server rejects a bump report if its own positions are further apart than this
  grabCooldown: 1.5,
  ramRange: 2.0, // metres: right up against the rival's cart to ram
  stealLagAllowance: 1.0, // the server accepts this much extra distance for network lag
  ramSpill: 0.3,
  ramMinZ: 100, // ram only works in the tunnel yard: north of this line (z in scene metres)
  pileSeconds: 20,
  pileCollectRange: 3.5,
  rookieTons: 10, // carts under this cannot be robbed
  maxLossFraction: 0.3, // a victim loses at most this share...
  lossWindow: 10, // ...in this many seconds
  immunitySeconds: 6,
  revengeBonus: 0.5,
  safeZoneRadius: 16, // metres around the Vault: no stealing, full stamina refill (doc says 10 m around base;
  //                     the vault and spawn are 13.5 m apart in this scene, so the circle is wider)

  // ---------- banking and tunnel ----------
  vaultRadius: 10,
  storeRadius: 9,
  tunnelQuota: 2000, // test value; live 100,000 t
  tunnelName: 'Tunnel 1',

  // ---------- bandits ----------
  raidOnHaul: true, // a raid also starts a few seconds after a loaded cart leaves a room...
  raidHaulDelay: 4, // ...this many seconds later (once the player is outside)
  raidHaulCooldown: 60, // ...unless a raid ended less than this many seconds ago
  firstRaidSeconds: 60, // first raid this long after the server wakes (then every 4-6 min)
  raidMinSeconds: 240,
  raidMaxSeconds: 360,
  raidSeconds: 60,
  banditCount: 2, // raid size with one hauler outside...
  banditsPerExtraHauler: 1, // ...plus this many per extra player hauling ore...
  banditMax: 6, // ...up to this many
  banditReinforceSeconds: 8, // extra bandits join one at a time, this often
  banditSpreadPenalty: 12, // metres: a cart already chased by another bandit counts as this much further away
  ambushRadius: 22, // a loaded cart this close to Bandit Spawn2 (the Narrow Pass) springs the ambush...
  ambushCount: 3, // ...this many bandits rush out...
  ambushSeconds: 30, // ...and give up after this long
  ambushCooldown: 120, // seconds before the pass can ambush again
  banditSpeed: 6.0, // m/s: a full cart that keeps running (6.5) just escapes; a full cart that jogs (5.2) gets caught
  banditSteal: 0.1, // share of the cart a touch steals
  banditTouch: 1.0, // metres: the bandit must touch your cart (or you), as YOUR screen shows it
  banditServerTouch: 3.5, // the server rejects a touch report if its own positions are further apart than this
  banditTackleForce: 14, // knockback strength when a bandit tackles you
  banditFleeSeconds: 6, // after a tackle the bandit runs off with the loot, then disappears
  banditScareRange: 10,
  banditSpawn: { x: 64, z: 92 }, // the Narrow Pass: where idle bandits prowl when nobody is hauling
  banditSideDistance: 16, // raid bandits appear this far to the LEFT and RIGHT of the target's way home...
  banditSideAhead: 4, // ...and this far ahead of it, so they cut in from the sides

  // ---------- cart ----------
  groundY: 0,
  cartModelHalfHeight: 0.29,
  cartFrontDistance: 1.6,
  cartAttachYOffset: 0, // raise (+) or lower (-) the cart if it floats or sinks relative to the avatar's feet
  cartYawOffset: 90,
  sideLabelOffset: { x: 0.9, y: 1.4, z: 0 },
  heapPieceSize: 0.32,
  cartParkSide: 2.5,
  cartParkFront: 3,

  // ---------- pickaxe in hand ----------
  axeModel: 'assets/Models/Axe/Axe.glb',
  axeHandleShift: 0.32,
  axeGrip: { px: 0, py: 0, pz: 0, rx: 90, ry: 0, rz: 0, scale: 0.9 },
  axeTuner: false, // dev panel to adjust the grip in Preview; keep false when publishing
  swingEmote: 'swingWeaponTwoHands',

  // ---------- tutorial arrows ----------
  arrowImage: 'assets/Images/ui/arrow.png',
  arrowTrailCount: 6,
  arrowTrailSpacing: 2.2,
  arrowTrailSize: 1.1,
  arrowTrailStart: 1.5,
  arrowTrailStopShort: 2,
  arrowFlowSpeed: 2.5,
  arrowYawOffset: -90,
  arrowMarkerSize: 1.6,
  arrowMarkerRoll: -90,

  noCollision: ['Gem1', 'Gold', 'Silver', 'Bronze'],
  oreTemplateNames: ['Bronze', 'Silver', 'Gold', 'Gem1'], // old template props in the scene, hidden at start

  // ---------- audio ----------
  musicFile: 'assets/Audio/main_theme.mp3',
  musicVolume: 0.35,
  buySound: 'assets/Audio/buy.mp3',
  buyVolume: 0.9,
  hitSound: 'assets/Audio/axe_hit.mp3',
  hitVolume: 0.8,
  breakSound: 'assets/Audio/rock_break.mp3',
  breakVolume: 0.9,
  collectSound: 'assets/Audio/ore_collect.mp3',
  collectVolume: 0.8,

  positionReportSeconds: 0.2, // clients report their position; the server uses it only when it has no transform of its own
  vaultFallback: { x: 64, z: 19.5 }, // used if the server cannot read the Vault from the scene

  debugPositions: false, // small readout (player / camera / cart positions) bottom-left; set false before publishing
  toastSeconds: 2.5,
  bannerSeconds: 6,
  saveEverySeconds: 60
}

// Names of scene entities the game uses
export const NAMES = {
  vault: 'Vault',
  forge: 'Axe_Upgrade_store',
  cartShop: 'Cart_Upgrade_Store',
  tunnelPad: 'MineSpawner0',
  returnPad: 'MineSpawnerreturn',
  roomPads: ['MineSpawner1', 'MineSpawner2', 'MineSpawner3', 'MineSpawner4'],
  roomWalls: ['Room1Wall1', 'Room2Wall1', 'Room3Wall1', 'Room4Wall1'],
  roomStrokes: ['Rock_Stroke1', 'Rock_Stroke2', 'Rock_Stroke3', 'Rock_Stroke4'],
  banditSpawns: ['Bandit Spawn1', 'Bandit Spawn2', 'Bandit Spawn3'], // west raid, Narrow Pass ambush, east raid
  docks: ['Mini cart_1', 'Mini cart_2', 'Mini cart_3', 'Mini cart_4', 'Mini cart_5']
}

export function upgradeCost(currentLevel: number): number | null {
  return currentLevel >= MAX_LEVEL ? null : UPGRADE_COSTS[currentLevel]
}
