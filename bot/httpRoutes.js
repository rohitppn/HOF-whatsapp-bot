import { getAppBaseUrl } from './runtime.js'

export function registerCoreRoutes(app, state) {
  app.get('/health', (req, res) => res.json({ ok: true }))

  app.get('/qr', (req, res) => {
    const qrReady = Boolean(state.latestQrImageUrl)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="10" />
    <title>HOF Bot QR</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#111827; color:#f9fafb; margin:0; padding:24px; }
      .card { max-width:520px; margin:40px auto; background:#1f2937; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,.35); }
      h1 { margin:0 0 12px; font-size:28px; }
      p { color:#d1d5db; line-height:1.5; }
      .meta { font-size:14px; color:#9ca3af; margin-top:12px; }
      img { display:block; width:100%; max-width:320px; margin:24px auto; background:#fff; padding:16px; border-radius:12px; }
      .status { display:inline-block; padding:6px 10px; border-radius:999px; background:#374151; font-size:13px; margin-top:8px; }
      code { background:#111827; padding:2px 6px; border-radius:6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>HOF WhatsApp QR</h1>
      <div class="status">WA status: ${state.latestWaStatus}</div>
      ${
        qrReady
          ? `<p>Scan this QR with WhatsApp Linked Devices. This page refreshes every 10 seconds.</p>
             <img src="${state.latestQrImageUrl}" alt="WhatsApp QR Code" />
             ${state.latestQrExternalUrl ? `<p><a href="${state.latestQrExternalUrl}" target="_blank" rel="noreferrer">Open QR image in a new tab</a></p>` : ''}
             <div class="meta">Last updated: ${state.latestQrUpdatedAt || 'unknown'}</div>`
          : `<p>No active QR is available right now.</p>
             <p>If the bot is already connected, that is expected. If you need a fresh QR, restart the bot session and reopen this page.</p>
             <div class="meta">Last QR update: ${state.latestQrUpdatedAt || 'never'}</div>`
      }
      <div class="meta">Health check: <code>/health</code></div>
    </div>
  </body>
</html>`)
  })

  app.get('/qr.json', (req, res) =>
    res.json({
      ok: true,
      connected: state.latestWaStatus === 'open',
      status: state.latestWaStatus,
      qrAvailable: Boolean(state.latestQrImageUrl),
      qrImageUrl: state.latestQrExternalUrl,
      updatedAt: state.latestQrUpdatedAt
    })
  )
}

export function buildServerLogMeta(port) {
  return {
    port,
    healthUrl: `${getAppBaseUrl()}/health`,
    qrUrl: `${getAppBaseUrl()}/qr`
  }
}
