import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, Transform } from '@dcl/sdk/ecs'
import { BOOTS, CART_CAPACITY, CONFIG, MAX_LEVEL, ORE, ORE_TYPES, OreType, PICKAXE_DAMAGE, UI_IMAGES, upgradeCost } from './config'
import { capacityOf, fmtTons, loadOf, questGoal, questProgress, QUESTS, questReward, tonsOf, valueOf } from './shared'
import {
  cartTons,
  completeTutorial,
  loaded,
  slowdown,
  me,
  myId,
  myStamina,
  rooms,
  serverAlive,
  serverNow,
  ui,
  TUTORIAL,
  TUTORIAL_STEPS,
  TutorialStep,
  world
} from './state'
import { applyAxeTransform, buy, claimRoom, deposit, equipCart, leaveRoom, myCartPosition, openForgeFromVault, putCartAway, restartTutorial, takeMyCart } from './game'
import { engine as ecsEngine } from '@dcl/sdk/ecs'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import { musicOn, toggleMusic } from './music'

// Custom fonts (SDK 7.31+). The mobile app and a desktop that has not converted them yet show bold sans-serif instead.
const FONT_TITLE = 'assets/fonts/LilitaOne-Regular.ttf'
const FONT_BODY = 'assets/fonts/Nunito-ExtraBold.ttf'

// ---------- palette: frontier timber and brass ----------
const C = {
  wood: Color4.create(0.16, 0.1, 0.06, 0.94),
  woodDark: Color4.fromHexString('#2B1D14F5'),
  woodLight: Color4.create(0.34, 0.21, 0.11, 1),
  brass: Color4.create(0.86, 0.66, 0.28, 1),
  brassDark: Color4.create(0.48, 0.33, 0.1, 1),
  cream: Color4.fromHexString('#FFF4E0FF'),
  muted: Color4.create(0.8, 0.72, 0.58, 1),
  gold: Color4.fromHexString('#FFC83DFF'),
  red: Color4.create(0.78, 0.18, 0.12, 1),
  redDark: Color4.create(0.45, 0.06, 0.04, 0.95),
  green: Color4.create(0.24, 0.56, 0.24, 1),
  stamina: Color4.create(0.36, 0.72, 0.3, 1),
  grey: Color4.create(0.32, 0.3, 0.28, 1),
  barBg: Color4.create(0, 0, 0, 0.55),
  clear: Color4.create(0, 0, 0, 0)
}

const oreColor = (k: OreType) => Color4.create(ORE[k].color.r, ORE[k].color.g, ORE[k].color.b, 1)

type ImageKey = Exclude<keyof typeof UI_IMAGES, 'enabled'>
const img = (key: ImageKey): string => (UI_IMAGES.enabled ? UI_IMAGES[key] : '')

type Slices = { top: number; bottom: number; left: number; right: number }
const PANEL_SLICES: Slices = { top: 0.32, bottom: 0.32, left: 0.12, right: 0.12 }
const BUTTON_SLICES: Slices = { top: 0.45, bottom: 0.45, left: 0.17, right: 0.17 }

// width / height of each icon PNG, so icons are never squashed
const ASPECT: Partial<Record<ImageKey, number>> = {
  coin: 234 / 232,
  copper: 280 / 216,
  silver: 278 / 216,
  gold: 276 / 216,
  gem: 256 / 217,
  cart: 346 / 266,
  axe: 248 / 264,
  foreman: 423 / 453,
  logo: 573 / 441,
  target: 1,
  check: 1,
  bandits: 752 / 328,
  room1: 345 / 264,
  room2: 342 / 264,
  room3: 339 / 264,
  room4: 341 / 264,
  cartFull: 906 / 450,
  keyE: 291 / 301,
  boots: 425 / 386,
  stamina: 286 / 351,
  equipCart: 1090 / 308
}

const DIGIT_ASPECT = [158 / 189, 114 / 183, 135 / 186, 141 / 189, 149 / 183, 138 / 186, 144 / 188, 132 / 183, 145 / 189, 140 / 188]

/** A number drawn with the digit PNGs (falls back to text if they are turned off). */
function ImageNumber(props: { value: number; height: number; color?: Color4 }) {
  const text = `${Math.max(0, Math.floor(props.value))}`
  if (!UI_IMAGES.enabled || !UI_IMAGES.digits)
    return <Label value={text} fontSize={props.height * 0.8} color={props.color ?? C.gold} font="sans-serif" fontSrc={FONT_TITLE} />
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: props.height }}>
      {text.split('').map((ch, i) => {
        const d = +ch
        return (
          <UiEntity
            key={`${i}`}
            uiTransform={{ width: Math.round(props.height * DIGIT_ASPECT[d]), height: props.height, margin: { left: i === 0 ? 0 : -props.height * 0.08 } }}
            uiBackground={{ texture: { src: `${UI_IMAGES.digits}${d}.png` }, textureMode: 'stretch' }}
          />
        )
      })}
    </UiEntity>
  )
}

function bg(key: ImageKey | null, color: Color4, slices?: Slices, tint?: Color4) {
  const src = key ? img(key) : ''
  if (!src) return { color }
  return slices
    ? { texture: { src }, textureMode: 'nine-slices' as const, textureSlices: slices, ...(tint ? { color: tint } : {}) }
    : { texture: { src }, textureMode: 'stretch' as const, ...(tint ? { color: tint } : {}) }
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiRoot, { virtualWidth: 1920, virtualHeight: 1080 })
  // phones: once the Explorer reports the platform, draw the UI ~25% smaller and start compact
  const platformSystem = () => {
    if (getPlatform() === null) return
    ecsEngine.removeSystem(platformSystem)
    if (!isMobile()) return
    ui.mobile = true
    ui.questsOpen = false
    ui.menuMin = true
    ReactEcsRenderer.setUiRenderer(uiRoot, { virtualWidth: 2560, virtualHeight: 1440 })
  }
  ecsEngine.addSystem(platformSystem)
}

let lastPanel = 'none'

const uiRoot = () => {
  const d = me()
  // menus step aside while the welcome screen or a dialog is showing
  const otherUiOpen = !!ui.dialog
  const menu = otherUiOpen ? 'none' : ui.panel
  // each station menu opens folded on phones, open on PC
  if (ui.panel !== lastPanel) {
    lastPanel = ui.panel
    ui.menuMin = ui.mobile
  }
  const w = world()
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      <LeftHud />
      <TunnelBar />
      <RightHud />
      <TutorialBanner />
      <Banner />
      {w?.raidActive && ui.inRoom === 0 && ui.banner.timeLeft <= 0 && d && d.hasCart && cartTons() >= CONFIG.rookieTons ? <BanditBanner /> : null}
      <Toast />
      {ui.inRoom > 0 && <RoomBar />}
      {ui.inRoom > 0 && !ui.mobile && d && cartTons() >= capacityOf(d) - 0.01 ? <CartFullBanner /> : null}
      {ui.inRoom > 0 && CONFIG.axeTuner && <AxeTuner />}
      {d && menu === 'vault' && <VaultPanel />}
      {d && menu === 'forge' && <ForgePanel />}
      {d && menu === 'rooms' && <RoomsPanel />}
      {ui.dialog && <DialogBox />}
      {!d || !serverAlive() ? <Connecting /> : null}
      {CONFIG.debugPositions ? <DebugPositions /> : null}
    </UiEntity>
  )
}

// ---------- building blocks ----------

function Badge(props: { image: ImageKey; color: Color4; letter: string; size: number }) {
  const src = img(props.image)
  if (src)
    return (
      <UiEntity
        uiTransform={{ width: Math.round(props.size * (ASPECT[props.image] ?? 1)), height: props.size, flexShrink: 0 }}
        uiBackground={{ texture: { src }, textureMode: 'stretch' }}
      />
    )
  return (
    <UiEntity
      uiTransform={{
        width: props.size,
        height: props.size,
        flexShrink: 0,
        borderRadius: props.size / 2,
        borderWidth: Math.max(2, props.size / 14),
        borderColor: C.brassDark,
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: props.color }}
    >
      <Label value={`<b>${props.letter}</b>`} fontSize={props.size * 0.48} color={C.woodDark} font="sans-serif" fontSrc={FONT_TITLE} />
    </UiEntity>
  )
}

function Card(props: { width: number | string; children?: ReactEcs.JSX.Element | (ReactEcs.JSX.Element | null)[] | null; border?: Color4; padding?: number; small?: boolean }) {
  const key: ImageKey = props.small ? 'panelSmall' : 'panel'
  const hasArt = !!img(key)
  return (
    <UiEntity
      uiTransform={{
        width: props.width as any,
        flexDirection: 'column',
        padding: props.padding ?? (hasArt ? (props.small ? 24 : 44) : 18),
        borderRadius: hasArt ? 0 : 18,
        borderWidth: hasArt ? 0 : 3,
        borderColor: props.border ?? C.brass
      }}
      uiBackground={bg(key, C.wood, PANEL_SLICES)}
    >
      {props.children}
    </UiEntity>
  )
}

function Divider() {
  return <UiEntity uiTransform={{ width: '100%', height: 2, margin: { top: 10, bottom: 10 } }} uiBackground={{ color: C.brassDark }} />
}

function ActionButton(props: { key?: string; text: string; onClick: () => void; kind?: 'go' | 'danger' | 'plain'; disabled?: boolean; width?: number; height?: number; fontSize?: number }) {
  const kind = props.kind ?? 'go'
  const color = props.disabled ? C.grey : kind === 'danger' ? C.red : kind === 'plain' ? C.woodLight : C.green
  const image: ImageKey = props.disabled ? 'buttonDark' : kind === 'danger' ? 'buttonRed' : kind === 'plain' ? 'buttonDark' : 'button'
  const hasArt = !!img(image)
  return (
    <Button
      value={`<b>${props.text}</b>`}
      fontSize={props.fontSize ?? 26}
      font="sans-serif"
      fontSrc={FONT_TITLE}
      color={props.disabled ? C.muted : C.cream}
      textWrap="nowrap"
      uiTransform={{ width: props.width ?? 280, height: Math.max(48, props.height ?? 62), borderRadius: hasArt ? 0 : 12, borderWidth: hasArt ? 0 : 2, borderColor: props.disabled ? C.grey : C.brass }}
      uiBackground={bg(image, color, BUTTON_SLICES, props.disabled ? Color4.create(0.55, 0.55, 0.55, 1) : undefined)}
      onMouseDown={() => {
        if (!props.disabled) props.onClick()
      }}
    />
  )
}

function Progress(props: { value: number; max: number; color: Color4; width: number; height?: number }) {
  const pct = Math.max(0, Math.min(1, props.max > 0 ? props.value / props.max : 0))
  const h = props.height ?? 16
  return (
    <UiEntity uiTransform={{ width: props.width, height: h, borderRadius: h / 2 }} uiBackground={{ color: C.barBg }}>
      {pct > 0 ? <UiEntity uiTransform={{ width: `${pct * 100}%`, height: '100%', borderRadius: h / 2 }} uiBackground={{ color: props.color }} /> : null}
    </UiEntity>
  )
}

function Text(props: { value: string; size?: number; color?: Color4; title?: boolean; align?: 'middle-left' | 'middle-right' | 'middle-center'; width?: number; grow?: boolean }) {
  return (
    <Label
      value={props.value}
      fontSize={props.size ?? 20}
      color={props.color ?? C.cream}
      font="sans-serif"
      fontSrc={props.title ? FONT_TITLE : FONT_BODY}
      textAlign={props.align ?? 'middle-left'}
      textWrap="nowrap"
      uiTransform={{ ...(props.width ? { width: props.width } : {}), ...(props.grow ? { flexGrow: 1 } : {}) }}
    />
  )
}

// ---------- HUD: top left (stamina, cart, revenge tag) ----------

function Bar(props: { label: string; value: string; current: number; max: number; color: Color4; alert: string; icon?: ImageKey }) {
  const alert = !!props.alert
  return (
    <UiEntity uiTransform={{ width: 380, flexDirection: 'column', margin: { bottom: 8 }, padding: { left: 16, right: 16, top: 8, bottom: 10 }, borderRadius: 14, borderWidth: 2, borderColor: alert ? C.red : C.brass }} uiBackground={{ color: C.woodDark }}>
      <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', alignItems: 'center' }}>
        {props.icon && img(props.icon) ? <Icon image={props.icon} height={26} /> : null}
        <Text value={`<b>${props.label}</b>`} size={18} color={C.brass} title grow />
        {alert ? <Text value={`<b>${props.alert}</b>`} size={20} color={C.red} title /> : null}
        <Text value={props.value} size={20} color={alert ? C.red : C.cream} title align="middle-right" width={120} />
      </UiEntity>
      <Progress value={props.current} max={props.max} color={alert ? C.red : props.color} width={348} height={14} />
    </UiEntity>
  )
}

function LeftHud() {
  const d = me()
  if (!d) return null
  const st = myStamina()
  const tons = cartTons()
  const cap = capacityOf(d)
  const l = loadOf(d)
  // left: 96 keeps the panels clear of the Explorer's own sidebar icons
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 24, left: 96 }, flexDirection: 'column' }}>
      <Bar icon="stamina" label=" STAMINA" value={`${Math.round(st.value)} / ${st.max}`} current={st.value} max={st.max} color={C.stamina} alert={st.tired ? 'TIRED' : ''} />
      {d.hasCart ? (
        <Bar label={`CART  Lv${d.cart}`} value={`${fmtTons(tons)} / ${cap} t`} current={tons} max={cap} color={C.brass} alert='' />
      ) : (
        <UiEntity uiTransform={{ width: 380, height: 44, margin: { bottom: 8 }, padding: { left: 16 }, borderRadius: 14, alignItems: 'center' }} uiBackground={{ color: C.woodDark }}>
          <Text value="No cart: press E at the Cart Dock" size={18} color={C.muted} />
        </UiEntity>
      )}
      {d.hasCart && slowdown() > 0 && !ui.mobile ? <Text value={`Cart weight: -${Math.round(slowdown() * 100)}% speed`} size={16} color={C.muted} /> : null}
      {d.hasCart && tons > 0 && !ui.mobile ? (
        <UiEntity uiTransform={{ flexDirection: 'row', margin: { bottom: 8 } }}>
          {ORE_TYPES.filter((k) => l[k] > 0.01).map((k) => (
            <UiEntity key={k} uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 32, margin: { right: 12 }, padding: { left: 6, right: 10 }, borderRadius: 16 }} uiBackground={{ color: C.woodDark }}>
              <Badge image={k} color={oreColor(k)} letter={ORE[k].label[0]} size={26} />
              <Text value={`${fmtTons(l[k])} t`} size={17} />
            </UiEntity>
          ))}
        </UiEntity>
      ) : null}
      {d.lastRobberName ? (
        <UiEntity uiTransform={{ height: 36, padding: { left: 14, right: 14 }, borderRadius: 12, alignItems: 'center', margin: { bottom: 8 } }} uiBackground={{ color: C.redDark }}>
          <Text value={`REVENGE: ${d.lastRobberName}  (+50%)`} size={17} title />
        </UiEntity>
      ) : null}
      {ui.mobile ? (
        <UiEntity uiTransform={{ margin: { bottom: 8 } }}>
          <ActionButton text={ui.hudMore ? 'Less ▴' : 'More ▾'} kind="plain" width={150} height={48} fontSize={18} onClick={() => (ui.hudMore = !ui.hudMore)} />
        </UiEntity>
      ) : null}
      {!ui.mobile || ui.hudMore ? (
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 40, padding: { left: 8, right: 14 }, borderRadius: 20 }} uiBackground={{ color: C.woodDark }}>
        <Badge image="axe" color={Color4.create(0.7, 0.74, 0.8, 1)} letter="P" size={30} />
        <Text value={`  Pickaxe Lv${d.pickaxe}   Cart Lv${d.cart}   Boots Lv${d.boots}`} size={16} title />
      </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ margin: { top: 8 } }}>
        {ui.inRoom === 0 && !d.hasCart ? (
          <UiEntity uiTransform={{ margin: { bottom: 8 } }}>
            <ImageButton image="equipCart" height={64} fallback="Equip Cart" onClick={() => equipCart()} />
          </UiEntity>
        ) : null}
        {ui.inRoom === 0 && d.hasCart && tons <= 0.01 ? (
          <UiEntity uiTransform={{ margin: { bottom: 8 } }}>
            <ActionButton text="Put cart away (F)" kind="plain" width={290} height={50} fontSize={18} onClick={() => putCartAway()} />
          </UiEntity>
        ) : null}
        {!ui.mobile || ui.hudMore ? (
        <UiEntity uiTransform={{ flexDirection: 'row' }}>
          <ActionButton text={musicOn() ? 'Music: On' : 'Music: Off'} kind="plain" width={150} height={44} fontSize={16} onClick={() => toggleMusic()} />
          <UiEntity uiTransform={{ width: 10 }} />
          <ActionButton
            text="Tutorial"
            kind="plain"
            width={130}
            height={44}
            fontSize={16}
            onClick={() => {
              introLine = 0
              restartTutorial()
            }}
          />
        </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

// ---------- HUD: top centre tunnel bar ----------

function TunnelBar() {
  const w = world()
  if (!w) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 18 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 460, flexDirection: 'column', alignItems: 'center', padding: { top: 6, bottom: 10, left: 18, right: 18 }, borderRadius: 14, borderWidth: 2, borderColor: C.brass }} uiBackground={{ color: C.woodDark }}>
        <Text value={`<b>ALL MINERS' HAUL · TUNNEL ${w.tunnel}</b>   ${Math.floor(w.tons)} / ${w.quota} t`} size={18} title align="middle-center" />
        <Progress value={w.tons} max={w.quota} color={C.gold} width={420} height={10} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------- HUD: top right (coins + quests) ----------

function RightHud() {
  const d = me()
  if (!d) return null
  const round = Math.max(1, d.qRound)
  const prog = questProgress(d)
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 24, right: 24 }, flexDirection: 'column', alignItems: 'flex-end' }}>
      <UiEntity uiTransform={{ height: 72, flexDirection: 'row', alignItems: 'center', padding: { left: 10, right: 26 }, borderRadius: 36, borderWidth: 3, borderColor: C.brass }} uiBackground={{ color: C.woodDark }}>
        <Badge image="coin" color={C.gold} letter="$" size={54} />
        <UiEntity uiTransform={{ margin: { left: 10 } }}>
          <ImageNumber value={d.coins} height={50} />
        </UiEntity>
      </UiEntity>
      {ui.tutorial !== 'done' && !ui.mobile ? <TutorialBoard /> : null}
      {ui.tutorial === 'done' ? (
        <UiEntity uiTransform={{ margin: { top: 12 }, width: 330, flexDirection: 'column', padding: { left: 10, right: 8, top: 6, bottom: 8 }, borderRadius: 12, borderWidth: 2, borderColor: C.brass }} uiBackground={{ color: C.woodDark }}>
          <UiEntity uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center' }}>
            <Badge image="target" color={C.red} letter="!" size={20} />
            <Label value={`QUESTS · ROUND ${round}`} fontSize={15} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" uiTransform={{ flexGrow: 1, margin: { left: 6 } }} />
            <Button value={ui.questsOpen ? '-' : '+'} fontSize={16} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ width: 28, height: 24, borderRadius: 6 }} uiBackground={{ color: C.woodLight }} onMouseDown={() => (ui.questsOpen = !ui.questsOpen)} />
          </UiEntity>
          {ui.questsOpen
            ? QUESTS.map((q, i) => {
                const goal = questGoal(i, round)
                const done = (d.qDone & (1 << i)) !== 0
                return (
                  <UiEntity key={q.key} uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 4 } }}>
                    <UiEntity uiTransform={{ width: '100%', height: 22, flexDirection: 'row', alignItems: 'center' }}>
                      <CheckMark done={done} size={16} />
                      <Label value={q.text(goal)} fontSize={12} color={done ? C.muted : C.cream} font="sans-serif" fontSrc={FONT_BODY} textAlign="middle-left" textWrap="nowrap" uiTransform={{ flexGrow: 1, margin: { left: 6 } }} />
                      <Label value={`${done ? goal : prog[i]}/${goal}`} fontSize={11} color={C.muted} font="sans-serif" fontSrc={FONT_BODY} uiTransform={{ margin: { right: 6 } }} />
                      <Badge image="coin" color={C.gold} letter="$" size={14} />
                      <Label value={`${questReward(i, round)}`} fontSize={12} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ margin: { left: 3 } }} />
                    </UiEntity>
                    <UiEntity uiTransform={{ margin: { left: 22 } }}>
                      <Progress value={done ? goal : prog[i]} max={goal} color={done ? C.green : C.brass} width={270} height={4} />
                    </UiEntity>
                  </UiEntity>
                )
              })
            : null}
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

function CheckMark(props: { done: boolean; size?: number }) {
  const n = props.size ?? 28
  const src = img('check')
  if (props.done && src) return <UiEntity uiTransform={{ width: n, height: n, flexShrink: 0 }} uiBackground={{ texture: { src }, textureMode: 'stretch' }} />
  return <UiEntity uiTransform={{ width: n, height: n, flexShrink: 0, borderRadius: n / 2, borderWidth: Math.max(2, n / 9), borderColor: props.done ? C.green : C.brass }} uiBackground={{ color: props.done ? C.green : C.clear }} />
}

// ---------- toast, banners, connecting ----------

function Toast() {
  if (ui.toast.timeLeft <= 0 || !ui.toast.text) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 160 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ minHeight: 56, alignItems: 'center', padding: { left: 30, right: 30, top: 10, bottom: 10 } }} uiBackground={bg('panelSmall', ui.toast.danger ? C.redDark : C.woodDark, PANEL_SLICES, ui.toast.danger ? Color4.create(1, 0.55, 0.5, 1) : undefined)}>
        <Label value={`<b>${ui.toast.text}</b>`} fontSize={20} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
      </UiEntity>
    </UiEntity>
  )
}

function Banner() {
  if (ui.banner.timeLeft <= 0 || !ui.banner.text) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 90 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ padding: { left: 22, right: 22, top: 7, bottom: 7 }, borderRadius: 12, borderWidth: 2, borderColor: C.gold }} uiBackground={{ color: C.wood }}>
        <Label value={`<b>${ui.banner.text}</b>`} fontSize={19} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} />
      </UiEntity>
    </UiEntity>
  )
}

function BanditBanner() {
  const art = img('bandits')
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 88 }, width: '100%', justifyContent: 'center' }}>
      {art ? (
        <UiEntity uiTransform={{ width: 190, height: Math.round(190 / (ASPECT.bandits ?? 2.3)) }} uiBackground={{ texture: { src: art }, textureMode: 'stretch' }} />
      ) : (
        <UiEntity uiTransform={{ padding: { left: 18, right: 18, top: 8, bottom: 8 }, borderRadius: 12 }} uiBackground={{ color: C.redDark }}>
          <Label value="BANDITS ON YOUR TAIL!" fontSize={22} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
        </UiEntity>
      )}
    </UiEntity>
  )
}

function Connecting() {
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 40 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ padding: { left: 24, right: 24, top: 10, bottom: 10 }, borderRadius: 14 }} uiBackground={{ color: C.woodDark }}>
        <Label value="Connecting to the mine office... (the server can take ~15 s to wake up)" fontSize={20} color={C.cream} font="sans-serif" fontSrc={FONT_BODY} />
      </UiEntity>
    </UiEntity>
  )
}

// ---------- curved title ----------
const LETTER_EM: Record<string, number> = { ' ': 0.32, I: 0.34, L: 0.58, T: 0.6, J: 0.5, F: 0.58, M: 0.86, W: 0.95 }

function CurvedTitle(props: { text: string; fontSize: number; width: number; height: number; arch: number }) {
  const letters = props.text.split('')
  const widths = letters.map((ch) => (LETTER_EM[ch] ?? 0.66) * props.fontSize)
  const total = widths.reduce((a, b) => a + b, 0)
  let x = (props.width - total) / 2
  return (
    <UiEntity uiTransform={{ width: props.width, height: props.height }}>
      {letters.map((ch, i) => {
        const w = widths[i]
        const centre = x + w / 2
        x += w
        if (ch === ' ') return null
        const t = (centre / props.width) * 2 - 1
        const lift = props.arch * (1 - t * t)
        return (
          <Label
            key={`${i}`}
            value={ch}
            fontSize={props.fontSize}
            font="sans-serif"
            fontSrc={FONT_TITLE}
            color={C.gold}
            textWrap="nowrap"
            textAlign="middle-center"
            uiTransform={{ positionType: 'absolute', position: { left: centre - w, top: (props.height - props.fontSize * 1.3) / 2 - lift + props.arch / 2 }, width: w * 2, height: props.fontSize * 1.3 }}
          />
        )
      })}
    </UiEntity>
  )
}

// ---------- tutorial ----------


const DUSTY_LINES = [
  "Fresh miner, eh? Tunnel One's open and the Company pays by the ton.",
  'Tap a rock, fill your cart, bring it to the vault.',
  'And keep moving. Ore in a cart belongs to whoever holds it last.'
]
let introLine = 0

function Welcome() {
  const logo = img('logo')
  const foreman = img('foreman')
  const last = introLine >= DUSTY_LINES.length - 1
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}>
      <Card width={900}>
        <UiEntity uiTransform={{ width: '100%', justifyContent: 'center', height: logo ? 300 : 80 }}>
          {logo ? (
            <UiEntity uiTransform={{ width: Math.round(300 * (ASPECT.logo ?? 1)), height: 300, justifyContent: 'center' }} uiBackground={{ texture: { src: logo }, textureMode: 'stretch' }}>
              <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 33, left: 55, right: 53 }, height: 48 }}>
                <CurvedTitle text="GOLD RUSH CARTS" fontSize={26} width={282} height={48} arch={8} />
              </UiEntity>
            </UiEntity>
          ) : (
            <Label value="<b>GOLD RUSH CARTS</b>" fontSize={60} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} />
          )}
        </UiEntity>
        <Divider />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center' }}>
          {foreman ? <UiEntity uiTransform={{ width: Math.round(170 * (ASPECT.foreman ?? 1)), height: 170, flexShrink: 0, margin: { right: 24 } }} uiBackground={{ texture: { src: foreman }, textureMode: 'stretch' }} /> : null}
          <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
            <Label value="<b>FOREMAN DUSTY</b>" fontSize={24} color={C.brass} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" />
            <Label font="sans-serif" fontSrc={FONT_BODY} value={`"${DUSTY_LINES[introLine]}"`} fontSize={24} color={C.cream} textAlign="top-left" textWrap="wrap" uiTransform={{ width: 560, height: 110, margin: { top: 8 } }} />
            <Label value={`${introLine + 1} / ${DUSTY_LINES.length}`} fontSize={14} color={C.muted} font="sans-serif" fontSrc={FONT_BODY} textAlign="middle-left" />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 24 }, flexShrink: 0 }}>
          <ActionButton
            text={last ? 'LET ME DIG' : 'CONTINUE'}
            width={300}
            onClick={() => {
              if (last) {
                completeTutorial('welcome')
                completeTutorial('meetDusty') // Dusty already gave the orders
              } else introLine++
            }}
          />
          <UiEntity uiTransform={{ width: 24 }} />
          <ActionButton text="SKIP" kind="plain" width={180} onClick={() => (ui.tutorial = 'done')} />
        </UiEntity>
      </Card>
    </UiEntity>
  )
}

function TutorialBanner() {
  const t = ui.tutorial
  if (t === 'welcome' || t === 'done' || ui.dialog) return null
  const n = TUTORIAL_STEPS.indexOf(t) + 1
  const step = TUTORIAL[t]
  const d = me()
  const showLoad = t === 'fillCart' && d
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 28 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: 980, height: 104, flexDirection: 'row', alignItems: 'center', padding: { left: 20, right: 18 }, borderRadius: 18, borderWidth: 3, borderColor: C.gold }} uiBackground={{ color: C.wood }}>
        <UiEntity uiTransform={{ width: 96, height: 76, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: 14, margin: { right: 18 } }} uiBackground={{ color: C.gold }}>
          <Label value="<b>STEP</b>" fontSize={14} color={C.woodDark} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 18 }} />
          <Label value={`<b>${n} / ${TUTORIAL_STEPS.length}</b>`} fontSize={24} color={C.woodDark} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 32 }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }}>
          <Label value={`<b>${step.title.toUpperCase()}</b>`} fontSize={18} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" uiTransform={{ height: 26 }} />
          <Label value={`<b>${step.text}</b>`} fontSize={22} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: 680, height: showLoad ? 30 : 52 }} />
          {showLoad ? (
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 24 }}>
              <Progress value={cartTons()} max={capacityOf(d)} color={C.brass} width={420} height={12} />
              <Label value={`  ${fmtTons(cartTons())} / ${capacityOf(d)} t`} fontSize={18} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
            </UiEntity>
          ) : null}
        </UiEntity>
        <ActionButton text="Skip tutorial" kind="plain" width={150} height={48} fontSize={16} onClick={() => (ui.tutorial = 'done')} />
      </UiEntity>
    </UiEntity>
  )
}

/** All tutorial steps on the right: done ones ticked, the current one highlighted, the rest dimmed. */
function TutorialBoard() {
  const cur = TUTORIAL_STEPS.indexOf(ui.tutorial)
  if (cur < 0) return null
  return (
    <UiEntity uiTransform={{ margin: { top: 12 }, width: 330, flexDirection: 'column', padding: { left: 12, right: 10, top: 8, bottom: 10 }, borderRadius: 12, borderWidth: 2, borderColor: C.brass }} uiBackground={{ color: C.woodDark }}>
      <Label value="<b>TUTORIAL</b>" fontSize={16} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" uiTransform={{ height: 26 }} />
      {TUTORIAL_STEPS.map((s, i) => {
        const done = i < cur
        const now = i === cur
        return (
          <UiEntity key={s} uiTransform={{ width: '100%', height: 26, flexDirection: 'row', alignItems: 'center', padding: { left: 6 }, borderRadius: 6 }} uiBackground={{ color: now ? Color4.create(0.86, 0.66, 0.28, 0.25) : C.clear }}>
            <CheckMark done={done} size={16} />
            <Label
              value={now ? `<b>${i + 1}. ${TUTORIAL[s].title}</b>` : `${i + 1}. ${TUTORIAL[s].title}`}
              fontSize={14}
              color={now ? C.gold : done ? C.muted : Color4.create(0.8, 0.72, 0.58, 0.55)}
              font="sans-serif"
              fontSrc={now ? FONT_TITLE : FONT_BODY}
              textAlign="middle-left"
              uiTransform={{ margin: { left: 8 } }}
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

// ---------- in a claim room ----------

function RoomBar() {
  const d = me()
  if (!d) return null
  const left = Math.max(0, Math.ceil((d.roomEndsAt - serverNow()) / 1000))
  const time = `${Math.floor(left / 60)}:${`${left % 60}`.padStart(2, '0')}`
  const full = cartTons() >= capacityOf(d) - 0.01
  const H = 76
  const tutorialOn = ui.tutorial !== 'done' && ui.tutorial !== 'welcome'
  const cell = (label: string, value: string, w: number, color = C.cream) => (
    <UiEntity uiTransform={{ width: w, height: H, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <Label value={label} fontSize={13} color={C.muted} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 18 }} />
      <Label value={`<b>${value}</b>`} fontSize={26} color={color} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 34 }} />
    </UiEntity>
  )
  const divider = () => <UiEntity uiTransform={{ width: 2, height: H - 26 }} uiBackground={{ color: C.brassDark }} />
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: tutorialOn ? 148 : 28 }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ height: H + 8, flexDirection: 'row', alignItems: 'center', padding: { left: 14, right: 12 }, borderRadius: 16, borderWidth: 3, borderColor: C.brass }} uiBackground={{ color: C.woodDark }}>
        {cell('CLAIM', `ROOM ${ui.inRoom}`, 150, C.gold)}
        {divider()}
        {cell('DEPTH', `${d.depth} m`, 130)}
        {divider()}
        {cell('TIME LEFT', time, 130, left <= 30 ? C.red : C.cream)}
        {divider()}
        <UiEntity uiTransform={{ width: 300, height: H, justifyContent: 'center', alignItems: 'center', margin: { left: 8 } }}>
          {ui.cartTaken ? (
            <ActionButton text="EXIT" kind="danger" width={240} height={60} fontSize={28} onClick={() => leaveRoom()} />
          ) : full ? (
            <ActionButton text={ui.mobile ? 'TAKE CART' : 'TAKE CART (E)'} width={260} height={60} fontSize={24} onClick={() => takeMyCart()} />
          ) : (
            <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
              <Label value="FILL YOUR CART" fontSize={13} color={C.muted} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 18 }} />
              <Progress value={cartTons()} max={capacityOf(d)} color={C.brass} width={260} height={14} />
              <Label value={`<b>${fmtTons(cartTons())} / ${capacityOf(d)} t</b>`} fontSize={20} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ height: 28 }} />
            </UiEntity>
          )}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ---------- NPC speech box ----------

function DialogBox() {
  const d = ui.dialog
  if (!d) return null
  const last = d.index >= d.lines.length - 1
  const portrait = d.portrait ? img(d.portrait as ImageKey) : ''
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 160 }, width: '100%', justifyContent: 'center' }}>
      <Card width={900} small>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center' }}>
          {portrait ? <UiEntity uiTransform={{ width: Math.round(120 * (ASPECT.foreman ?? 1)), height: 120, flexShrink: 0, margin: { right: 18 } }} uiBackground={{ texture: { src: portrait }, textureMode: 'stretch' }} /> : null}
          <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
            <Label value={d.name.toUpperCase()} fontSize={22} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} textAlign="middle-left" uiTransform={{ height: 30 }} />
            <Label value={`"${d.lines[d.index]}"`} fontSize={21} color={C.cream} font="sans-serif" fontSrc={FONT_BODY} textAlign="top-left" textWrap="wrap" uiTransform={{ width: portrait ? 520 : 650, height: 64 }} />
          </UiEntity>
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <ActionButton
              text={last ? 'Close' : 'Next'}
              kind={last ? 'plain' : 'go'}
              width={130}
              height={52}
              fontSize={20}
              onClick={() => {
                if (!ui.dialog) return
                if (last) {
                  // finishing Foreman Dusty's orders opens the tutorial board
                  if (ui.dialog.name === 'Foreman Dusty') completeTutorial('meetDusty')
                  ui.dialog = null
                } else ui.dialog.index++
              }}
            />
            <Label value={`${d.index + 1} / ${d.lines.length}`} fontSize={14} color={C.muted} font="sans-serif" fontSrc={FONT_BODY} />
          </UiEntity>
        </UiEntity>
      </Card>
    </UiEntity>
  )
}

// ---------- dev: pickaxe grip ----------

function AxeTuner() {
  const t = ui.axeTune
  type Key = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'scale'
  const rows: { key: Key; label: string; step: number }[] = [
    { key: 'px', label: 'Pos X', step: 0.05 },
    { key: 'py', label: 'Pos Y', step: 0.05 },
    { key: 'pz', label: 'Pos Z', step: 0.05 },
    { key: 'rx', label: 'Rot X', step: 15 },
    { key: 'ry', label: 'Rot Y', step: 15 },
    { key: 'rz', label: 'Rot Z', step: 15 },
    { key: 'scale', label: 'Scale', step: 0.05 }
  ]
  const change = (k: Key, d: number) => {
    t[k] = Math.round((t[k] + d) * 100) / 100
    applyAxeTransform()
  }
  const small = (text: string, fn: () => void) => (
    <Button font="sans-serif" fontSrc={FONT_BODY} value={text} fontSize={20} color={C.cream} uiTransform={{ width: 40, height: 32, margin: { left: 4 }, borderRadius: 6 }} uiBackground={{ color: C.woodLight }} onMouseDown={fn} />
  )
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 24, bottom: 40 } }}>
      <Card width={280} small>
        <Text value="<b>PICKAXE GRIP (dev)</b>" size={16} color={C.brass} />
        {rows.map((r) => (
          <UiEntity key={r.key} uiTransform={{ width: '100%', height: 36, flexDirection: 'row', alignItems: 'center' }}>
            <Text value={`${r.label}  ${t[r.key]}`} size={15} grow />
            {small('-', () => change(r.key, -r.step))}
            {small('+', () => change(r.key, r.step))}
          </UiEntity>
        ))}
      </Card>
    </UiEntity>
  )
}

// ---------- panels (open near the vault, the forge and the tunnel entrance) ----------

function Menu(props: { title: string; subtitle: string; width?: number; children?: (ReactEcs.JSX.Element | null)[] | ReactEcs.JSX.Element }) {
  // folded: a small tab on the right; tap it to open the menu
  if (ui.menuMin) {
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 24, top: '45%' } }}>
        <ActionButton text={`${props.title}  ▸`} width={300} height={64} fontSize={22} onClick={() => (ui.menuMin = false)} />
      </UiEntity>
    )
  }
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 230 }, width: '100%', justifyContent: 'center' }}>
      <Card width={props.width ?? 560}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', height: 0 }}>
          <Button value="<b>–</b>" fontSize={28} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} uiTransform={{ positionType: 'absolute', position: { top: -8, right: -6 }, width: 52, height: 44, borderRadius: 10 }} uiBackground={{ color: C.woodLight }} onMouseDown={() => (ui.menuMin = true)} />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center' }}>
          <Label value={`<b>${props.title}</b>`} fontSize={36} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} />
          <Label font="sans-serif" fontSrc={FONT_BODY} value={props.subtitle} fontSize={18} color={C.cream} />
        </UiEntity>
        <Divider />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', padding: { top: 4 } }}>{props.children}</UiEntity>
      </Card>
    </UiEntity>
  )
}

function VaultPanel() {
  const d = me()!
  const l = loadOf(d)
  const filled = ORE_TYPES.filter((k) => l[k] > 0.01)
  return (
    <Menu title="DEPOSIT" subtitle="Mae weighs your ore and pays in coin">
      {filled.length > 0 ? (
        filled.map((k) => (
          <UiEntity key={k} uiTransform={{ width: '100%', height: 44, flexDirection: 'row', alignItems: 'center' }}>
            <Badge image={k} color={oreColor(k)} letter={ORE[k].label[0]} size={34} />
            <Text value={`${ORE[k].label}   ${fmtTons(l[k])} t × ${ORE[k].value}`} size={22} grow />
            <Text value={`${Math.floor(l[k] * ORE[k].value + 1e-6)}`} size={22} color={C.gold} align="middle-right" />
          </UiEntity>
        ))
      ) : (
        <Text value="Your cart is empty. Go dig!" size={22} color={C.muted} align="middle-center" />
      )}
      <Divider />
      <UiEntity uiTransform={{ width: '100%', height: 48, flexDirection: 'row', alignItems: 'center' }}>
        <Text value={`<b>TOTAL  ${fmtTons(tonsOf(l))} t</b>`} size={24} color={C.brass} title grow />
        <Badge image="coin" color={C.gold} letter="$" size={34} />
        <Text value={`<b> ${valueOf(l)}</b>`} size={30} color={C.gold} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', margin: { top: 12, bottom: 6 }, flexDirection: 'row', justifyContent: 'center' }}>
        <ActionButton text="DEPOSIT" width={220} height={64} fontSize={28} onClick={() => deposit()} disabled={tonsOf(l) <= 0.01} />
        <UiEntity uiTransform={{ width: 14 }} />
        <ActionButton text="Upgrades ▸" kind="plain" width={190} height={64} fontSize={22} onClick={() => openForgeFromVault()} />
      </UiEntity>
    </Menu>
  )
}

function UpgradeCard(props: { key?: string; title: string; level: number; now: string; next: string; kind: 'pickaxe' | 'cart' | 'boots' }) {
  const d = me()!
  const cost = upgradeCost(props.level)
  const canAfford = cost !== null && d.coins >= cost
  return (
    <UiEntity uiTransform={{ width: 270, flexDirection: 'column', alignItems: 'center', margin: { left: 6, right: 6, bottom: 8 }, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: C.brassDark }} uiBackground={{ color: C.woodDark }}>
      <Icon image={props.kind === 'pickaxe' ? 'axe' : props.kind === 'cart' ? 'cart' : 'boots'} height={64} />
      <Text value={`<b>${props.title}</b>`} size={26} color={C.gold} title align="middle-center" />
      <Text value={`Lv${props.level}${props.level < MAX_LEVEL ? `  →  Lv${props.level + 1}` : '  (max)'}`} size={20} align="middle-center" />
      <Text value={props.now} size={17} color={C.muted} align="middle-center" />
      {cost !== null ? <Text value={`<b>${props.next}</b>`} size={18} color={C.gold} align="middle-center" /> : null}
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 44, margin: { top: 6 } }}>
        {cost !== null ? <Badge image="coin" color={C.gold} letter="$" size={28} /> : null}
        <Text value={cost !== null ? ` ${cost}` : 'MAX'} size={26} color={cost === null || canAfford ? C.gold : C.red} title />
      </UiEntity>
      <ActionButton text={cost === null ? 'MAXED' : 'BUY'} width={200} height={56} disabled={!canAfford} onClick={() => buy(props.kind)} />
    </UiEntity>
  )
}

function ForgePanel() {
  const d = me()!
  const pk = d.pickaxe
  const ct = d.cart
  const bt = d.boots
  const nextOf = (lv: number) => Math.min(MAX_LEVEL, lv + 1) - 1
  return (
    <Menu title="IRONJAW'S FORGE" subtitle="Better steel, deeper ore." width={960}>
      <UiEntity uiTransform={{ flexDirection: 'row' }}>
        <UpgradeCard key="p" kind="pickaxe" title="PICKAXE" level={pk} now={`Damage ${PICKAXE_DAMAGE[pk - 1]} per hit`} next={`Damage ${PICKAXE_DAMAGE[nextOf(pk)]}${pk === 1 ? ' · cracks silver' : ''}`} />
        <UpgradeCard key="c" kind="cart" title="CART" level={ct} now={`Holds ${CART_CAPACITY[ct - 1]} t`} next={`Holds ${CART_CAPACITY[nextOf(ct)]} t`} />
        <UpgradeCard key="b" kind="boots" title="BOOTS" level={bt} now={`Stamina ${BOOTS[bt - 1].max} · +${BOOTS[bt - 1].regen}/s`} next={`Stamina ${BOOTS[nextOf(bt)].max} · +${BOOTS[nextOf(bt)].regen}/s`} />
      </UiEntity>
    </Menu>
  )
}

function RoomsPanel() {
  const r = rooms()
  const d = me()!
  const id = myId()
  if (!r) return null
  const full = r.owners.every((o) => o !== '')
  return (
    <Menu title="TUNNEL 1 · CLAIM ROOMS" subtitle={full ? 'All rooms are taken: mine the open seam in the yard (robbable!)' : `Private mining for ${Math.round(CONFIG.roomSeconds / 60)} minutes, one trip per claim`}>
      {r.owners.map((owner, i) => {
        const left = owner ? Math.max(0, Math.ceil((r.endsAt[i] - serverNow()) / 1000)) : 0
        return (
          <UiEntity key={`${i}`} uiTransform={{ width: '100%', height: 64, flexDirection: 'row', alignItems: 'center' }}>
            <Text value={`<b>ROOM ${i + 1}</b>`} size={24} color={C.gold} title width={130} />
            <Text value={owner ? `${r.names[i]}  ·  ${Math.floor(left / 60)}:${`${left % 60}`.padStart(2, '0')}` : 'Free'} size={20} color={owner ? C.muted : C.cream} grow />
            <ActionButton text={owner === id ? 'YOURS' : owner ? 'TAKEN' : 'CLAIM'} width={170} height={52} fontSize={22} disabled={!!owner || !d.hasCart} onClick={() => claimRoom(i + 1)} />
          </UiEntity>
        )
      })}
      {!d.hasCart ? <Text value="Take a cart from the dock first (E)." size={18} color={C.red} align="middle-center" /> : null}
    </Menu>
  )
}

// ---------- debug: where the scene thinks things are ----------

function DebugPositions() {
  const f = (v: { x: number; z: number } | null | undefined) => (v ? `${v.x.toFixed(1)}, ${v.z.toFixed(1)}` : '-')
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  const cam = Transform.getOrNull(engine.CameraEntity)?.position
  const cart = myCartPosition()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 96, bottom: 16 }, padding: { left: 10, right: 10, top: 4, bottom: 4 }, borderRadius: 8 }} uiBackground={{ color: Color4.create(0, 0, 0, 0.6) }}>
      <Label value={`player ${f(p)}   camera ${f(cam)}   cart ${f(cart)}   room ${ui.inRoom}`} fontSize={16} color={C.cream} font="monospace" />
    </UiEntity>
  )
}

// ---------- room: cart full ----------

function CartFullBanner() {
  const art = img('cartFull')
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 200 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}>
      {art ? (
        <UiEntity uiTransform={{ width: 320, height: Math.round(320 / (ASPECT.cartFull ?? 2)) }} uiBackground={{ texture: { src: art }, textureMode: 'stretch' }} />
      ) : (
        <Label value="<b>CART IS FULL!</b>" fontSize={34} color={C.gold} font="sans-serif" fontSrc={FONT_TITLE} />
      )}
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: 6 }, padding: { left: 18, right: 18, top: 6, bottom: 6 }, borderRadius: 12 }} uiBackground={{ color: C.woodDark }}>
        {ui.cartTaken ? (
          <Label value="<b>Click EXIT to haul it home.</b>" fontSize={22} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
        ) : (
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
            <Label value="<b>Press</b>" fontSize={22} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
            <UiEntity uiTransform={{ margin: { left: 8, right: 8 } }}>
              <Icon image="keyE" height={38} />
            </UiEntity>
            <Label value="<b>(or tap TAKE CART) to take your cart, then click EXIT.</b>" fontSize={22} color={C.cream} font="sans-serif" fontSrc={FONT_TITLE} />
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

// ---------- art helpers ----------

/** A UI image at its own aspect ratio (nothing when the art is switched off). */
function Icon(props: { image: ImageKey; height: number }) {
  const src = img(props.image)
  if (!src) return null
  return <UiEntity uiTransform={{ width: Math.round(props.height * (ASPECT[props.image] ?? 1)), height: props.height, flexShrink: 0 }} uiBackground={{ texture: { src }, textureMode: 'stretch' }} />
}

/** A button drawn entirely by its artwork; falls back to a plain button when the art is off. */
function ImageButton(props: { image: ImageKey; height: number; fallback: string; onClick: () => void }) {
  const src = img(props.image)
  if (!src) return <ActionButton text={props.fallback} width={290} height={56} fontSize={22} onClick={props.onClick} />
  return (
    <UiEntity
      uiTransform={{ width: Math.round(props.height * (ASPECT[props.image] ?? 3)), height: props.height }}
      uiBackground={{ texture: { src }, textureMode: 'stretch' }}
      onMouseDown={props.onClick}
    />
  )
}
