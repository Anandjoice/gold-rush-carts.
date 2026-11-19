// Components and messages must be defined before the engine starts, on both the server and the client.
import './shared'
import { isServer } from '@dcl/sdk/network'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server')
    initServer()
    return
  }
  const { setupGame } = await import('./game')
  const { setupUi } = await import('./ui')
  const { setupMusic } = await import('./music')
  const { setupNpcs } = await import('./npcs')
  setupGame()
  setupUi()
  setupMusic()
  setupNpcs()
}
