# Gold Rush Carts — V0 Prototype Document

**Updated Nov 19, 2026** (first version Nov 18, 2026) · @joice

This document describes the V0 prototype **as it is built**. All numbers are the live values in `src/config.ts`.

## What changed since the Nov 18 version

| Area | Nov 18 plan | Now (built) |
|---|---|---|
| Weight | HEAVY at 70% load: no running, stamina regen halved | **HEAVY removed.** The fuller the cart, the slower you move: up to −35% speed at a full cart. Regen is never halved. |
| Claim rooms | 8 rooms, tap a free door in a hallway | **4 rooms** (the 4 built in the scene; more after V0 approval). You claim a room on a **claim board** at the Tunnel 1 entrance and are teleported in. |
| Leaving a room | Walk out, or moved out after 3 min | The cart waits beside the ore face. When it is full, tap **TAKE CART** (or press E / F anywhere in the room); the **EXIT** button then appears and teleports you outside the tunnel with your cart. The 3-minute limit still moves you out with your cart. |
| Ore face | 9 glowing spheres; the face slides back | The **3×3 cubes with ore crystals placed in each room**. Click anywhere on the face; broken rocks pop off and fall. Clearing all 9 makes a **new face pop in** with a "DEPTH 20 m" banner (no slide). |
| Wall colour by depth | Walls darken with depth | **Later stage.** In V0 each face cube is **tinted by the ore it holds** (copper orange, silver grey, gold amber, gem purple). |
| Depth | Only the first 10 m face; saved depth in V1 | The full depth table works and **depth is saved** in V0. |
| Saves and fairness | Peer-to-peer sync, victim's client validates steals; save platform TBD | **Decentraland Multiplayer Server** (`@dcl/sdk@auth-server`): the server owns the economy, checks every steal and saves progress in Storage. |
| Running limit | InputModifier | Speed set through `AvatarLocomotionSettings` (works on mobile too). |
| Stealing range | Grab within 2.5 m, ram within 3.5 m | **Grab within 1.5 m, ram within 2 m** of the rival's cart: you must be right at it. |
| Bandits | Run straight at the cart; a touch steals 10% | Bandits **path around obstacles** (through the Narrow Pass or the west side route), must **physically touch** your cart, **tackle** you (knockback), steal 10% and run off. Raids also start a few seconds after someone hauls a loaded cart out. |
| Open seam | Shared seam in the yard | Appears and works **only when all 4 rooms are taken**. |
| Equipping a cart | E on a dock cart | E on a dock cart **or** the **Equip Cart** button on the HUD (the cart appears in front of you). |
| Cart tiers | Lv1 model with a colour tint | Lv1 model with a **coloured trim band** per tier; full tier models in V1. |
| Tutorial | Foreman intro (3 lines) | **10-step tutorial** that starts by talking to Foreman Dusty, with a step board and a "Skip tutorial" button. |
| Tunnel rotation | Paused | Still paused: hitting the quota shows the rotation banner only. Rotation comes in a later stage. |
| Players | 2–8 | **V0 playtest with 4 players**; the 8-player / 30 fps test moves to V1. |
| Scene size | 4 × 4 now, 6 × 6 planned | **8 × 12 parcels (128 × 192 m)**. |

## Overview

V0 is a playable slice that proves the core promise: mine ore, haul it home in a cart, bank it before another player or a bandit robs you.

| | |
|---|---|
| Player promise | You are a gold miner. You mine ore and push it home in your cart to get rich, while other players and bandits can rob you before you bank. |
| V0 goal | One full loop (claim room → mine → take cart → exit → haul → deposit → upgrade) plus stealing, bandit raids and saved progress, playtested by 4 players in a Decentraland World. |
| Platform | Decentraland SDK 7 (TypeScript), Creator Hub, Multiplayer Server (`@dcl/sdk@auth-server`), deployed to a World |
| Characters | Decentraland avatars; NPCs and bandits use AvatarShape |
| Scene size | 8 × 12 parcels (128 × 192 m) |
| Session length | 3–10 minutes; one loop ≈ 90 s |
| Status | Deployed to the World anandjoice.dcl.eth with the Multiplayer Server (2026-11-19). Next: 4-player playtest. |
| Funding round | V0 — $1,000 on completed, playtestable scope |

## V0 scope

| In V0 | Not in V0 (later) |
|---|---|
| Tunnel 1 with **4** Claim Rooms (private mining), claim board at the entrance | Rooms 5–8; Tunnels 2–5 rooms (boarded-up entrances only) |
| 3×3 ore face per room, full depth table (copper → silver → gold → gem), saved depth | Milestone chambers, lamp oil, cave-ins |
| Pickaxe in hand inside rooms + swing on click, dust puff | 5 pickaxe models (V0 has the Lv1 model only) |
| Cart that follows the player; ore heap grows and glows by value | Cart tier models and paint (V0: trim band per tier) |
| **Cart weight slows the player** (up to −35% at full) | Sabotage items (oil, crates, dynamite) |
| Stamina for mining, grabbing, ramming, scaring bandits | Bounty crown, thief glow, leaderboards |
| Vault Deposit panel + Forge upgrades (Pickaxe, Cart, Boots) | Armor Plates, Lantern, cosmetics |
| Grab and Ram outside the tunnel, spilled piles, protection rules | Daily quest reset, streak |
| Persistence: coins, upgrades, depth, quests, tutorial done; shared tunnel tons | Tunnel rotation, "Next tunnel: ???", Miner's Coffee |
| Bandit raids that path around obstacles and tackle | Obstacles outside the mine to escape bandits (V1) |
| Foreman Dusty (tutorial), Ironjaw the Smith, Mae at the vault, Wheelwright Bo | Wall colour by depth, audio polish, VFX, events |
| 3 session quests (repeat in rounds) | 8-player and mobile performance test (V1) |

## Start-to-end player flow

A new player reaches the first deposit in about 90 seconds of play after the tutorial starts.

1. **Spawn (0 s)** — You appear at Lanternhold base near the Cart Dock. Arrows lead to Foreman Dusty. Tunnel 1 is open at the north end; Tunnels 2–5 are boarded up.
2. **Meet Dusty (0–10 s)** — Talk to Foreman Dusty: 3 lines. When he finishes, the tutorial board opens (or press "Skip tutorial").
3. **Get a cart** — Press E on one of the 5 dock carts (a new one pops in its place) or tap **Equip Cart** on the HUD.
4. **Claim a room (10–30 s)** — Walk to the Tunnel 1 entrance; the claim board shows Rooms 1–4 with owners and time left. Tap CLAIM on a free room. You are teleported in; the room's sign shows your name; only you may be inside for 3 minutes. A pickaxe appears in your right hand.
5. **Mine the face (30–70 s)** — Click anywhere on the 3×3 ore face. Each click swings the pickaxe; the rock shakes, dust puffs; the last hit pops it off the wall, it falls, and the ore flies into your cart (parked beside the face).
6. **Go deeper** — Clear all 9 rocks: a new face pops in and a "DEPTH 20 m" banner shows. Depth is saved.
7. **Cart full** — When the cart is full, the room bar shows a **TAKE CART** button. Tap it, or press E or F anywhere in the room, to take the cart; then the **EXIT** button appears. (PC also shows a "CART IS FULL!" banner.)
8. **Haul home (70–90 s)** — Click EXIT: you and your cart appear outside the tunnel. The fuller the cart, the slower you move. From here on rivals can grab or ram you, and bandits may come.
9. **Deposit (≈ 90 s)** — At the vault counter the Deposit panel lists each ore × value. Tap DEPOSIT: "Weighed and paid: +{coins} coins", the tunnel bar rises for everyone.
10. **Upgrade** — Tap "Upgrades ▸" on the Deposit panel or visit Ironjaw's Forge: Pickaxe Lv2 (60 coins) cracks silver from 30 m; Cart Lv2 holds 35 t; Boots Lv2 gives 125 stamina.
11. **Steal or be robbed** — Outside the tunnel, stand at a rival's cart: click it or run into it to grab 3 t, press E to ram and spill 30% (tunnel yard only). Bandits raid every 4–6 minutes and shortly after a loaded haul: keep running, reach the safe zone, or tap them to scare them off (15 stamina).
12. **Quests and tunnel** — 3 session quests; when all 3 are done, the next round starts with bigger goals and rewards. Tunnel rotation is paused for V0 (quota shows a banner).
13. **Leave and return** — Coins, upgrades, depth, quest progress and "tutorial done" are saved. Cart ore is lost if you leave without depositing.

## Controls

Every action is a click/tap on a world object or a HUD button, so desktop and mobile play the same.

| Action | Desktop | Mobile |
|---|---|---|
| Move | WASD | Joystick |
| Talk to an NPC | Click the NPC | Tap the NPC |
| Get a cart | E on a dock cart, or click **Equip Cart** | Action button on a dock cart, or tap **Equip Cart** |
| Put an empty cart away | F, or click **Put cart away** | Tap **Put cart away** |
| Claim room | Walk onto the Tunnel 1 entrance → click CLAIM on the board | Same, tap CLAIM |
| Mine | Click anywhere on the ore face (one swing per 0.6 s) | Tap the face |
| Take the full cart | TAKE CART button, or E / F anywhere in the room | TAKE CART button, or the E / F buttons |
| Leave the room | Click EXIT (after taking the cart) | Tap EXIT |
| Haul | Automatic: the cart rides in front of you | Automatic |
| Deposit | Walk to the vault counter → click DEPOSIT | Tap DEPOSIT |
| Upgrade | Click "Upgrades ▸" or walk to Ironjaw's Forge → BUY | Tap BUY |
| Grab ore | Click a rival's cart (within 1.5 m), or run into it | Tap a rival's cart (within 1.5 m), or run into it |
| Ram | E on a rival's cart (within 2 m, tunnel yard only) | Action button |
| Collect pile | Click the glowing pile | Tap the pile |
| Scare a bandit | Click the bandit (15 stamina) | Tap the bandit |

## Systems and tuning

All numbers live in `src/config.ts`, so balance changes need no code edits.

### Ore

| Ore | Value / t | Tons per rock | Rock HP | Seam respawn | Needs |
|---|---|---|---|---|---|
| Copper | 1 | 4 | 4 | 20 s | Pickaxe Lv1 |
| Silver | 3 | 4 | 6 | 35 s | Pickaxe Lv2 |
| Gold | 8 | 4 | 8 | 50 s | Pickaxe Lv3 |
| Gem | 25 | 2 | 10 | 80 s | Pickaxe Lv4 |

### Upgrades (cost to reach Lv2 / 3 / 4 / 5: 60 / 300 / 1,200 / 4,000 coins)

| Upgrade | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 |
|---|---|---|---|---|---|
| Pickaxe (damage per hit) | 1 | 1.5 | 2 | 3 | 4 |
| Cart (capacity, t) | 20 | 35 | 55 | 80 | 110 |
| Boots (max stamina / regen per s) | 100 / 8 | 125 / 9 | 150 / 10 | 180 / 12 | 220 / 14 |

Buying a cart upgrade upgrades the cart you have on the spot (more capacity, new trim band). Lv4 carts lose 15% less to grabs, Lv5 carts 25% less.

### Stamina and cart weight

- Costs: pickaxe swing 3, grab 10, ram 40, scare bandit 15.
- Regen starts 1 s after the last spend, at the Boots rate. Full refill inside the safe zone.
- At 0 stamina: **TIRED** — no swinging and no running for 3 s.
- **Cart weight:** speed drops in proportion to the load, up to −35% at a full cart (jog 8 → 5.2 m/s, run 10 → 6.5 m/s). The HUD shows "Cart weight: −X% speed".

### Banking and tunnel

- At the vault counter the Deposit panel lists each ore × value and the total; DEPOSIT turns ore into coins.
- Banked tons add to the shared tunnel bar ("ALL MINERS' HAUL · TUNNEL 1"); 2,000 t (test value; live 100,000 t) shows the rotation banner to every player. Rotation itself is paused in V0.

### Stealing and protection (checked by the server)

- **Grab:** 3 t per click, 1.5 s cooldown, within 1.5 m of the rival's cart, outside the safe zone.
- **Crash grab:** running into a rival's cart (within 1.3 m) grabs ore the same as clicking it, with the same rules and cooldown. A crash that breaks a rule does nothing.
- **Ram:** tunnel yard only (north of the dividing wall), within 2 m; spills 30% as a pile that lasts 20 s; anyone with a cart can collect it.
- **Safe zone:** 16 m around the Vault (covers spawn and the vault counter): no stealing, full stamina.
- **Rookie rule:** carts under 10 t cannot be robbed (by players or bandits).
- A victim loses at most 30% in 10 s, then gets 6 s immunity; one ram also gives 6 s immunity.
- **Revenge:** stealing from your last robber pays +50%.
- No stealing inside rooms; robbing starts outside the tunnel.
- The server allows 1 m for network lag on every steal distance.

### Session quests (saved; repeat in rounds)

| Quest (round 1) | Reward |
|---|---|
| Mine 12 rocks | 40 coins |
| Bank one trip of 15 t+ | 40 coins |
| Grab 6 t from rivals — or bank 4 times | 60 coins |

When all 3 are done, round 2 starts with goals and rewards × 2, then × 3, and so on.

## Claim rooms, depth, pickaxe, vault, tunnels, saves

Mining is private and safe inside Claim Rooms; all risk sits on the haul home.

### Claim rooms

- **4 rooms** in Tunnel 1 (V0). Walk onto the Tunnel 1 entrance: the claim board lists Rooms 1–4, the owner's name and the time left. CLAIM a free room to be teleported in. A sign in each room shows its owner (or FREE).
- Only the owner may be inside; anyone else who walks in is moved out.
- One trip per claim, max 3 minutes. You need a cart to claim.
- Your cart waits beside the ore face. When it is full, tap TAKE CART (or press E / F anywhere in the room), then EXIT: you are teleported outside the tunnel with the cart. When time runs out you are moved out with your cart and the room frees up.
- All rooms full → the shared **open seam** in the tunnel yard appears; anyone can mine it, and it is robbable.

### Depth: rolling ore face

- Each room's back wall holds a 3×3 face of cubes with ore crystals. Click anywhere on the face; the server breaks the next rock (top row first). A broken rock pops off the wall and falls to the floor. The face has no physical collision, so players never bump into it.
- Clear all 9 → a new face pops in, "DEPTH +10 m". Each cube is tinted by the ore it holds.
- Depth is saved per player and loads into any room you claim.

| Depth | Ore mix | Needs |
|---|---|---|
| 0–30 m | Copper | Pickaxe Lv1 |
| 30–60 m | Copper + Silver | Pickaxe Lv2 |
| 60–100 m | Silver + Gold | Pickaxe Lv3 |
| 100 m+ | Gold + 1 rare gem per face | Pickaxe Lv4 |

### Pickaxe

- Attached to the right hand inside your room (and at the open seam while it is in use), hidden everywhere else.
- Click → swing emote, hit sound, dust puff, rock shake; one swing per 0.6 s. If the emote does not play, the attached pickaxe model animates a chop.

### Vault and Forge

- Deposit panel at the vault counter (inside the safe zone) with an "Upgrades ▸" shortcut to the Forge.
- The Forge panel shows three cards (Pickaxe, Cart, Boots) with now → next values, the price and a BUY button. It opens at Ironjaw's Forge, at Wheelwright Bo's cart shop, or from "Upgrades ▸".

### Tunnels

- One tunnel open; quota 2,000 t (test). Hitting it shows "Tunnel 1 quota reached! Next tunnel: ??? (rotation paused for V0)". Random rotation, sealing and Crystal Heart come in a later stage.

### Persistence (Multiplayer Server Storage)

- **Saved per wallet:** coins, Pickaxe / Cart / Boots levels, depth, quest round and progress, tutorial done. Cart ore is never saved.
- **Global:** tunnel number and tons.
- Load on join; save on deposit, upgrade, new depth, finished quest, finished tutorial and leave, plus every 60 s if anything changed.

### Cart Dock and carts

- The Cart Dock at base holds 5 carts. E equips one; a new cart pops in its place, so 5 are always waiting.
- The **Equip Cart** HUD button puts your cart in front of you anywhere outside the rooms.
- F or "Put cart away" removes an empty cart. With ore loaded: "Deposit your ore at the vault first!"
- A label floats beside the player: "Press F to unequip" when empty, "12 / 20 t" when loaded (white text, black outline).
- Your cart always has your own tier. V0 shows the tier with a coloured trim band (Lv2 metal, Lv3 iron, Lv4 steel, Lv5 brass that glows); full tier models in V1.

| Lv | Look (V1 model) | Capacity | Extra |
|---|---|---|---|
| 1 | Small rickety wooden cart | 20 t | — |
| 2 | Reinforced wood, metal corners | 35 t | — |
| 3 | Iron-banded, bigger wheels, name plate | 55 t | — |
| 4 | Steel with side armor plates | 80 t | Grabs take 15% less |
| 5 | Big brass cart with 2 lanterns | 110 t | Grabs take 25% less, glows |

## Bandits (NPC raids)

- **Spawn points:** Bandit Spawn1 (west of the tunnel yard) and Bandit Spawn3 (east) for raids; Bandit Spawn2 (inside the Narrow Pass) for an ambush.
- **Raids:** 60 s after the server starts, then every 4–6 min, and 4 s after a loaded cart (10 t+) leaves a room. Bandits come alternately from Spawn1 and Spawn3, closing in from the left and right. A raid lasts 60 s.
- **More haulers, more bandits:** 2 for one hauler, +1 per extra hauler, up to 6; extras join every 8 s ("More bandits are coming!").
- **Spreading out:** a cart already chased counts as farther away, so bandits shift between players running past.
- **Ambush:** a loaded cart within 22 m of Spawn2 makes 3 bandits rush out ("AMBUSH at the Narrow Pass!"); they give up after 30 s; the pass re-arms after 2 min.
- **Pathfinding:** bandits go around mountains and buildings. Speed 6 m/s: keep running with a full cart and you escape; jog and you're caught.
- **Tackle:** a bandit must touch your cart (or you) within 1 m; it knocks you back, steals 10% and runs off.
- **Defend:** tap a bandit (15 stamina), keep running, or reach the safe zone. Carts under 10 t are ignored.
- Each bandit has a red **BANDIT** tag; the "Bandits on your tail!" banner shows to players with a robbable cart.

## Map layout

The map runs south to north (scene metres, z grows north):

```
N   z 150–162   4 CLAIM ROOMS (private, 3x3 ore face each)
    z 126–142   TUNNEL MOUNTAIN: 5 entrances at z ≈ 127 (Tunnel 1 open at x 44, 2–5 boarded up)
    z 100–125   TUNNEL YARD (ram zone) + open seam (only when rooms are full)
                Bandit Spawn1 (x 17, z 113, west) · Bandit Spawn3 (x 113, z 113, east)
    z  62–78    DIVIDING WALL: [SIDE ROUTE west, x ≈ 5]  ......  [NARROW PASS archway, x 60–66, Bandit Spawn2 = ambush]
    z  30–60    COPPER FLATS (grab only), Cart Dock (x ≈ 38, z 55–61)
S   z   0–35    BASE: spawn (x 63, z 33), Vault + Mae (x 64, z 19), Forge + Ironjaw (x 98, z 37),
                Cart shop + Bo (x 33, z 37), Foreman Dusty — safe zone 16 m around the Vault
```

### Assets (V0)

| Asset | V0 | Final (V1) |
|---|---|---|
| Canyon, mountains, tunnel entrances | Low-poly GLB models placed in the Creator Hub | Same, more variety |
| Ore face | 3×3 cubes with ore crystal models, tinted by ore | Rock meshes, full and cracked |
| Cart | Lv1 push-cart model + tier trim band | 5 tier models |
| Ore heap | Small ore models filling the cart + glowing slab by value | Same |
| Spilled pile | Glowing gold cylinder | Pile mesh, 4 colours |
| NPCs and bandits | AvatarShape with base wearables | Styled outfits |
| Signs | Floating text (room owners) | Wooden signboards |

## UI, NPCs and dialogue

Style: "frontier timber and brass" — dark wood panels, brass accents, Lilita One and Nunito fonts.

| HUD element | Position | Shows |
|---|---|---|
| Stamina bar | Top left | Current / max; red and TIRED at 0 |
| Cart bar | Top left | Tons / capacity, ore chips, "Cart weight: −X% speed" |
| Revenge tag | Under the cart bar | Name of your last robber (+50%) |
| Levels + buttons | Top left | Pickaxe / Cart / Boots levels, Equip Cart or Put cart away, Music, Tutorial |
| Tunnel bar | Top centre | "ALL MINERS' HAUL · TUNNEL 1", tons / quota |
| Coins + board | Top right | Coins; the tutorial step board, then the Quests board |
| Toast | Top centre | 2.5 s message, red for danger |
| Banner | Under the tunnel bar | Raid / depth / quota news, 6 s |
| Room bar | Bottom (in a room) | Room, depth, time left, fill progress / TAKE CART / EXIT |
| Cart full banner | Centre (in a room) | "CART IS FULL!" + what to do next |
| Tutorial banner | Bottom | Step n / 10, title, instruction, Skip |

Panels: Deposit (vault), Forge (3 cards), Claim board (tunnel entrance), NPC dialog box (bottom).

**PC and mobile layouts:** The game detects the platform at start. **PC:** full HUD, 10-step tutorial board, CART IS FULL banner, panels open fully. **Mobile:** the UI is drawn ~25% smaller; only stamina, cart load, tunnel bar and coins stay on screen; levels, Music and Tutorial sit behind a More ▾ button; the quests board starts folded; the tutorial shows only its one-line banner; station panels (Deposit, Forge, claim board) open folded as small tabs. Every station panel has a – button that folds it into a tab on the right (tap to reopen).

**Tutorial (10 steps):** 1 Meet Foreman Dusty · 2 Get a cart · 3 Claim a room · 4 Swing your pickaxe · 5 Fill your cart · 6 Take your cart · 7 Leave the mine · 8 Haul it home · 9 Deposit · 10 Upgrade. The step follows what the player is doing, so it never gets stuck; finishing shows "Tutorial complete!". Returning players skip it; the Tutorial button replays it.

| NPC | Role | Lines in V0 |
|---|---|---|
| Foreman Dusty | Tutorial start | "Fresh miner, eh? Tunnel One's open and the Company pays by the ton." · "Tap a rock, fill your cart, bring it to the vault." · "And keep moving. Ore in a cart belongs to whoever holds it last." |
| Ironjaw the Smith | Forge (upgrades) | "Better steel, deeper ore." · "Pickaxe, cart or boots: tap BUY on the board when you have the coin." · "Pickaxe Lv2? That will crack silver." |
| Mae | Vault counter | "Welcome to the Vault, miner." · "Bring your cart to the counter and tap DEPOSIT. I weigh it and pay you in coin." · "This is the safe zone: no stealing here, and your stamina fills right up." |
| Wheelwright Bo | Cart shop (opens the Forge panel) | "Bigger cart, bigger haul." · "A loaded cart is a slow cart. Ironjaw sells bigger carts." · "Just remember: a full cart is a fat target for bandits." |

System messages: "Too tired! Catch your breath." · "Cart full! Tap TAKE CART (or press E / F)." · "More bandits are coming!" · "AMBUSH at the Narrow Pass!" · "Needs Pickaxe Lv2 — see Ironjaw" · "{name} is grabbing your ore!" · "RAMMED by {name}! Ore spilled!" · "Shaken — safe for 6 s." · "Weighed and paid: +{coins} coins" · "Safe zone — no stealing here." · "Not worth it — cart under 10 t." · "TACKLED by a bandit! It stole {t} t of your ore!" · "Deposit your ore at the vault first!" · "Not enough coin. Go dig."

## Tech, code map, run and deploy

| File | Purpose |
|---|---|
| `src/config.ts` | All tuning numbers and UI art paths |
| `src/shared.ts` | Synced components, server messages, quest definitions (client + server) |
| `src/server.ts` | Multiplayer Server: saves, rooms, mining, stealing, banking, upgrades, stamina, bandits |
| `src/game.ts` | Client: carts, dock, rooms, ore face, seam, piles, steal clicks, speed, tutorial logic |
| `src/state.ts` | Client state, tutorial steps, toasts, server clock |
| `src/ui.tsx` | HUD, panels, tutorial board, dialogs (React-ECS) |
| `src/npcs.ts`, `src/bandits.ts` | NPCs; bandit avatars, tags and touch detection |
| `src/nav.ts`, `src/navgrid.ts` | Bandit pathfinding over the walkable map |
| `scripts/build-navgrid.js` | Rebuilds `navgrid.ts` from the scene after obstacles move: `node scripts/build-navgrid.js` |
| `scene.json` | 96 parcels (8 × 12), spawn point, `authoritativeMultiplayer: true`, World name (to set) |
| `design/gdd.md` | Program GDD |

**Networking:** the Multiplayer Server is the only writer of game state. Clients send intents (claim, hit, grab, deposit, buy…) through `registerMessages`; the server validates sender, distance, stamina and rules, then updates synced components (`Miner`, `Stamina`, `World`, `Rooms`, `Pile`, `SeamRock`, `Bandit`). Clients report their position 5 times a second; the server uses its own player transform when it has one. Bandit touches are reported by the victim's client and checked by the server.

**Run and deploy**
1. `npm install`, then open the folder in the Creator Hub and press Play (Multiplayer Server starts with the preview).
2. Test stealing with two preview windows signed in with **different** accounts.
3. Set the World NAME in `scene.json` → `worldConfiguration.name`.
4. Publish from the Creator Hub (Publish → World) or `npm run deploy -- --target-content https://worlds-content-server.decentraland.org`.
5. Push the repo to GitHub with the README linking the deployed World.

## Test plan and acceptance criteria

V0 passes when every box below is ticked in a deployed World with 4 players, on desktop (and checked on the mobile client).

- [ ] A new player finds Foreman Dusty and gets a cart without help
- [ ] Playtesters can say the goal ("fill the cart, bank it") within 10 s of the tutorial
- [ ] Cart follows the player smoothly; its heap grows and glows
- [ ] A loaded cart visibly slows the player; TIRED at 0 stamina stops running for 3 s
- [ ] Banking converts ore to coins and moves the tunnel bar for all players
- [ ] Each upgrade visibly changes play (silver unlock, bigger cart, more stamina)
- [ ] Grab moves 3 t between two players at the cart; ram spills a pile anyone can collect
- [ ] Safe zone, rookie rule and 6 s immunity block steals as designed
- [ ] Open-seam rocks respawn and stay in sync across clients (when all rooms are full)
- [ ] Tunnel quota triggers the rotation banner for every player
- [ ] A player claims a room on the board and a second player cannot stay inside it
- [ ] Clearing the 3×3 face brings a new face and depth goes up by 10 m
- [ ] Full cart → TAKE CART (or E / F) → EXIT → player and cart appear outside the tunnel
- [ ] A bandit raid starts; bandits go around obstacles; a touch tackles and steals 10%; tapping a bandit scares it away
- [ ] Pickaxe shows in hand inside the room and swings on each click
- [ ] Deposit panel shows the right ore × value total
- [ ] Rejoining loads coins, upgrades, depth and quests
- [ ] E on a dock cart equips it and a new cart appears in its place (5 always waiting); Equip Cart works anywhere outside the rooms
- [ ] F unequips an empty cart; with ore loaded it shows "Deposit your ore at the vault first!"
- [ ] The label beside the player switches between "Press F to unequip" and the load
- [ ] The tutorial runs from Dusty to Upgrade without getting stuck
- [ ] On mobile the HUD is compact and station panels open folded; nothing covers the play view
- [ ] Running into a loaded rival cart grabs ore; the Narrow Pass ambush triggers near Bandit Spawn2
- [ ] (V1) Runs at 30 fps on the test phone with 8 players

### Playtest script (15 min, 4 players)

1. Spawn with no explanation; note time to first rock and first deposit.
2. After 5 min, ask each player: "What are you trying to do?"
3. Minute 5–10: ask two players to rob each other in the tunnel yard.
4. Minute 10–15: free play; count voluntary extra trips.
5. Ask: "Would you come back tomorrow? Why?" and note confusing moments.

## Known limits, risks and next steps

| Risk or limit | Impact | Fallback / next step |
|---|---|---|
| Map positions guessed in config (Narrow Pass spawn, ram line, seam) | Bandits or the seam in the wrong spot | Check in a playtest; adjust `banditSpawn`, `ramMinZ`, `seamOrigin` |
| Server cold start in a deployed World (~15 s) | First actions wait | "Connecting to the mine office…" notice until the server is up |
| Walkable map built from model bounds | An odd model could block or open a gap | Rebuild with `node scripts/build-navgrid.js`; exclude the model by name |
| Explorer crash on empty materials (found and fixed) | Scene suspended | Never write an empty `Material`; check `Player.log` after changes |
| Only 4 rooms | Queue at busy times | Open seam fallback; add rooms after V0 approval |
| Not yet tested on mobile or with 8 players | Unknown performance | Mobile check in V0; 8-player test in V1 |

**Next steps to V1:** World deployment → 4-player playtest → obstacles outside the mine → cart tier models → wall colour by depth → rooms 5–8 → daily quests and streak → bounty crown and leaderboards → tunnel rotation → audio → 8-player test → launch Event.
