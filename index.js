import { isOpenClawEnabled } from './services/openclaw.js'
import { registerCoreRoutes, buildServerLogMeta } from './bot/httpRoutes.js'
import {
  ALLOWED_GROUPS,
  getStoresFromEnv,
  MANAGERS_GROUP_ID
} from './bot/storeConfig.js'
import {
  app,
  HANDLER_VERSION,
  log,
  OPENCLAW_MANAGER_ONLY,
  port,
  TIMEZONE
} from './bot/runtime.js'
import { createBotState } from './bot/state.js'
import { startSock } from './bot/socket.js'

const state = createBotState()

registerCoreRoutes(app, state)

log.info({ HANDLER_VERSION }, 'boot')
log.info(
  {
    LOG_LEVEL: process.env.LOG_LEVEL,
    TIMEZONE,
    ALLOWED_GROUPS,
    MANAGERS_GROUP_ID,
    STORES_COUNT: getStoresFromEnv().length,
    OPENCLAW_ENABLED: isOpenClawEnabled(),
    OPENCLAW_MANAGER_ONLY
  },
  'boot config'
)

app.listen(port, () => log.info(buildServerLogMeta(port), 'server on'))

startSock({ app, state }).catch(err => log.error({ err }, 'fatal error'))
