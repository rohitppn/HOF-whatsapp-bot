export function createBotState() {
  return {
    latestQrText: null,
    latestQrImageUrl: null,
    latestQrExternalUrl: null,
    latestQrUpdatedAt: null,
    latestWaStatus: 'starting',
    botPausedUntilMs: 0,
    temporaryStoreClosures: new Map()
  }
}

export function isBotPaused(state) {
  return state.botPausedUntilMs > Date.now()
}

export function getPauseRemainingHours(state) {
  if (!isBotPaused(state)) return 0
  return Math.max(
    1,
    Math.ceil((state.botPausedUntilMs - Date.now()) / (60 * 60 * 1000))
  )
}
