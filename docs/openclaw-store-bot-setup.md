# OpenClaw Store Bot Setup

This document configures OpenClaw as the "brain" for the HOF Ops Bot.

## Architecture

- `HOF Ops Bot` receives WhatsApp messages and writes operational data.
- `OpenClaw` receives webhook events from the bot and decides whether it should speak.
- `HOF Ops Bot` exposes `POST /openclaw/callback` so OpenClaw can send back actions.

## Environment

HOF bot `.env`:

```env
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_HOOK_TOKEN=shared-secret
OPENCLAW_HOOK_PATH=/hooks
OPENCLAW_AGENT_ID=hooks
OPENCLAW_MODEL=
OPENCLAW_THINKING=
OPENCLAW_TIMEOUT_SECONDS=120
OPENCLAW_CALLBACK_TOKEN=strong-callback-secret
```

OpenClaw config must contain:

```json
"hooks": {
  "enabled": true,
  "token": "shared-secret",
  "path": "/hooks",
  "allowedAgentIds": ["hooks", "main"],
  "allowRequestSessionKey": false,
  "internal": {
    "enabled": true,
    "entries": {
      "session-memory": {
        "enabled": true
      }
    }
  }
}
```

## Callback Contract

OpenClaw should send actions back to:

```text
POST http://127.0.0.1:3000/openclaw/callback
Authorization: Bearer strong-callback-secret
Content-Type: application/json
```

Allowed actions:

### 1. Send message to store group

```json
{
  "action": "send_group_message",
  "message": "AMBIENCE, ARDEE, please share your hourly sales report for 5-6 PM.",
  "targetGroups": ["120363421937484089@g.us"]
}
```

### 2. Ask clarification in the same store group

```json
{
  "action": "ask_clarification",
  "groupJid": "120363421937484089@g.us",
  "message": "Please confirm the store name and achieved amount so I can record this update."
}
```

### 3. Notify manager group

```json
{
  "action": "notify_manager",
  "message": "Manager alert: KHAN MARKET has still not submitted the 4-5 PM report."
}
```

### 4. Multiple actions in one callback

```json
{
  "actions": [
    {
      "action": "notify_manager",
      "message": "Manager alert: Big bill recorded for OBEROI."
    },
    {
      "action": "send_group_message",
      "message": "Excellent work OBEROI team. Big bill recorded successfully.",
      "targetGroups": ["120363421937484089@g.us"]
    }
  ]
}
```

## OpenClaw Agent Prompt

Create or configure the `hooks` agent in OpenClaw with this instruction:

```text
You are the operations brain for a retail WhatsApp bot.

You receive webhook events from the HOF Ops Bot about store operations, reminders, manager commands, and unstructured WhatsApp messages.

Your job is to decide whether the bot should speak in the store group, ask for clarification, notify the manager group, or stay silent.

You do not send WhatsApp messages directly. Instead, when action is needed, you must trigger the HOF bot callback endpoint with a strict JSON payload.

Callback endpoint:
POST http://127.0.0.1:3000/openclaw/callback
Authorization: Bearer strong-callback-secret
Content-Type: application/json

Allowed actions:
1. send_group_message
2. ask_clarification
3. notify_manager

Operational rules:
- Be concise, respectful, and professional.
- Do not reply to casual chatter, jokes, or acknowledgements unless there is operational value.
- If store staff clearly intend to report opening, hourly report, or big bill but key fields are missing, ask for clarification.
- If there is delay, missed reporting, dress-code issue, or store confusion, reply in a helpful operational way.
- If there is escalation risk, notify the manager group.
- If the event is already fully handled and no further value is added, do nothing.
- Never fabricate stores, values, or timings.
- Use the store group for store-facing replies.
- Use notify_manager for manager-facing escalation.

When you decide to act, return or trigger only one of the allowed callback payloads.
If no action is needed, do nothing.
```

## Event Interpretation Guide

The HOF bot sends OpenClaw event summaries like:

```text
Retail ops event from WhatsApp.
Type: hourly_report
Group: 120363421937484089@g.us
Sender: Rohit
Time: 2026-04-03 15:10:00
Text: ...
Structured result: hourly:KHAN MARKET:3-4 PM
Stores: AMBIENCE, ARDEE, KHAN MARKET, ...
Recent knowledge: [...]
```

Interpretation:

- `Type: hourly_report`, `opening_report`, `big_bill`, `dress_check`
  Usually no reply needed unless escalation or coaching is useful.
- `Type: clarification_requested`
  Usually no extra action unless the manager should be notified.
- `Type: unhandled_group_message`
  This is the main case where OpenClaw should think and decide if the bot should talk.
- `Manager command/event from WhatsApp`
  Use manager context. If it implies a store-group communication, send `send_group_message`.

## Recommended OpenClaw Logic

1. If the event is already structured and complete:
- Usually do nothing.

2. If the event indicates confusion or missing fields:
- Use `ask_clarification`.

3. If the event indicates a manager escalation:
- Use `notify_manager`.

4. If the group needs a helpful operational reply:
- Use `send_group_message`.

5. If nothing useful should be said:
- Stay silent.

## Terminal Tests

### Test callback endpoint directly

```bash
curl -i -X POST http://127.0.0.1:3000/openclaw/callback \
  -H 'Authorization: Bearer strong-callback-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "notify_manager",
    "message": "OpenClaw callback test successful."
  }'
```

### Test OpenClaw wake endpoint

```bash
curl -i -X POST http://127.0.0.1:18789/hooks/wake \
  -H 'Authorization: Bearer shared-secret' \
  -H 'Content-Type: application/json' \
  -d '{"text":"test from hof bot","mode":"now"}'
```

## Rollout Advice

Start with this behavior:

- Allow `notify_manager`
- Allow `ask_clarification`
- Use `send_group_message` only when clearly necessary

Once stable, let OpenClaw speak more often in store groups.
