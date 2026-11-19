# Gold Rush Carts

You are a gold miner. You mine ore and push it home to get rich, while rivals and bandits can rob your cart.

A multiplayer Decentraland SDK7 scene built for the Decentraland Creator Success Program (V0).

- **Play:** https://decentraland.org/jump/?realm=anandjoice.dcl.eth&referrer=0x09c3a03ffefa9dbffb07c0177ef4c8a70cb61dae
- **World:** anandjoice.dcl.eth (coordinates 0,0)
- **GDD:** [design/gdd.md](design/gdd.md)
- **V0 prototype document:** [design/v0-prototype.md](design/v0-prototype.md)

## Core loop

Take a cart → claim a private room in Tunnel 1 → mine the 3×3 ore face → take the full cart and exit → haul it home past rival players and bandit raids → deposit at the vault for coins → upgrade pickaxe, cart and boots → go deeper.

## Run locally

1. Install the [Creator Hub](https://decentraland.org/download/creator-hub).
2. In the **Scenes** tab, import this folder and press **Preview** (the Multiplayer Server starts with the preview).
3. Or from the command line: `npm install`, then `npm run start`.

Test stealing with two preview windows signed in with different accounts.

## Code map

| File | Purpose |
|---|---|
| `src/config.ts` | Tuning numbers and UI art paths |
| `src/shared.ts` | Synced components, server messages, quests |
| `src/server.ts` | Multiplayer Server: saves, rooms, mining, stealing, banking, upgrades, stamina, bandits |
| `src/game.ts` | Client: carts, dock, rooms, ore face, piles, steal clicks, speed, tutorial |
| `src/ui.tsx` | HUD, panels, tutorial, dialogs |
| `src/npcs.ts`, `src/bandits.ts` | NPCs and bandits |
| `src/nav.ts`, `src/navgrid.ts`, `scripts/build-navgrid.js` | Bandit pathfinding |

## Team

Anand Joice — Discord: anandjoice18 · tullimalli654@gmail.com
