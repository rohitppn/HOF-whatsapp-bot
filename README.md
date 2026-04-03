# HOF Ops Bot

WhatsApp operations bot for HOF retail reporting.

## What It Does

- Captures opening updates into Google Sheets
- Captures hourly sales reports into Google Sheets
- Checks dress-code photos
- Tracks big bills
- Sends scheduled reminders
- Integrates with OpenClaw for smarter manager/store interactions

## Stack

- Node.js
- Baileys (WhatsApp Web)
- Google Sheets API
- OpenAI API
- OpenClaw webhook bridge
- PostgreSQL (optional memory layer)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
cp .env.example .env
```

3. Fill `.env` with your real values.

4. Start the bot:

```bash
npm start
```

## Important Local-Only Files

Do not commit these:

- `.env`
- `auth/`
- Google service account JSON
- `node_modules/`

## Railway Note

If you deploy this bot to Railway:

- `OPENCLAW_BASE_URL` must point to a reachable OpenClaw instance
- OpenClaw callback URL must use your public Railway URL, not `http://127.0.0.1:3000`
- WhatsApp auth in `auth/` needs persistent storage, or the session will break on redeploy

## OpenClaw Callback

The bot exposes:

```text
POST /openclaw/callback
```

Supported actions:

- `send_group_message`
- `ask_clarification`
- `notify_manager`
- `update_sheet`
