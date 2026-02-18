# Plan: Setting Up ClawdBot (WhatsApp Gateway) on Oracle Cloud VM

This plan describes how to run the WhatsApp transport on an always-on Oracle Cloud VM so it integrates with the Hot Bags backend. See the **ClawdBot architecture summary** (components, Hot Bags contract, command_id dedupe, idempotency) for the interface and trust boundary. This repo implements a standalone gateway using whatsapp-web.js.

---

## 1. Oracle VM basics

- **Shape:** Small always-on instance (e.g. AMD 1 OCPU, 1–6 GB RAM). WhatsApp session + retry queue and optional OpenClaw need minimal CPU; 24/7 uptime matters.
- **OS:** Ubuntu 22.04 or 24.04 LTS (or Oracle Linux if you prefer; steps assume Debian/Ubuntu).
- **Network:** Allow outbound HTTPS to Hot Bags (Vercel) and to WhatsApp. No inbound ports required unless you expose a Control UI or health endpoint; if you do, restrict by IP and use TLS.
- **Storage:** Persistent volume for session auth (`DATA_DIR/wwebjs_auth/`), SQLite queue (`QUEUE_DB_PATH`), and `command_id` dedupe. 10–20 GB is plenty.

---

## 2. Node.js and whatsapp-web.js

- **Node 20+:** Required. Install via NodeSource on Ubuntu:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **This gateway:** Uses `whatsapp-web.js` for WhatsApp Web session (Puppeteer/Chromium).
- **Auth directory:** `DATA_DIR/wwebjs_auth/`. Session persists on disk.
- **Link WhatsApp (one-time or after re-auth):** Prefer scanning on the VM so auth matches production. Use `set -a; source /etc/clawdbot/env; set +a; npm run dev` or `./scripts/run-qr-scan.sh`.
- **Run gateway 24/7:** Use systemd. See `systemd/clawdbot-gateway.service` or `systemd/clawdbot.service.example`.

---

## 3. Gateway logic (bridge to Hot Bags)

Implemented in this repo:

1. **Inbound message** → build payload (`message_id`, `chat_id`, `from`, `text`, `media[]`, `timestamp`, `raw`) → POST to Hot Bags with Bearer auth + `Idempotency-Key: message_id`
2. **2xx response** → parse `commands[]`, dedupe by `command_id`, execute `send_text`
3. **Non-2xx or network error** → enqueue to retry queue (SQLite)
4. **Retry worker** → runs every 30s, retries failed requests (max 100 attempts)

---

## 4. Auth and secrets (Gateway → Hot Bags)

- **Bearer token:** `Authorization: Bearer <HOTBAGS_BEARER_TOKEN>`. Must match Hot Bags `WHATSAPP_GATEWAY_TOKEN`.
- **HMAC (optional):** Set `HOTBAGS_HMAC_SECRET` only if Hot Bags validates `X-HotBags-Signature`.
- **Idempotency key:** `Idempotency-Key: message_id` header.
- **Secrets:** Store in `/etc/clawdbot/env` with `chmod 600`.

---

## 5. Idempotency and command dedupe

- **Idempotency key:** Same `message_id` on retry → Hot Bags returns same `commands[]`.
- **Command dedupe:** SQLite table `outbound_sent`; skip if `(message_id, command_id)` exists.
- **Queue:** SQLite `inbound_queue`; persist across restarts.

---

## 6. Payload and contract alignment

- **Outbound:** `message_id`, `chat_id`, `from`, `text`, `media[]`, `timestamp`, `raw`, `transport_session_id`
- **Inbound:** `commands[]` with `command_id`, `type`, `text`; execute `send_text` to chat.

---

## 7. Session stability and ops

- **Reconnect:** whatsapp-web.js auto-reconnects. On logout, delete `DATA_DIR/wwebjs_auth/` and run `npm run dev` to rescan QR.
- **Logging:** Tag with `GATEWAY_INSTANCE_ID` and `message_id`.

---

## 8. Checklist

1. Provision Oracle VM (Ubuntu 22/24, outbound HTTPS, persistent volume)
2. Install Node 20+, clone this repo, `npm ci && npm run build`
3. Create `/etc/clawdbot/env` with `HOTBAGS_INGEST_URL`, `HOTBAGS_BEARER_TOKEN`, `HOTBAGS_HMAC_SECRET`, `QUEUE_DB_PATH`, `DATA_DIR`, `GATEWAY_INSTANCE_ID`. Use `HOTBAGS_HMAC_DISABLED=true` only for temporary Bearer-only mode.
4. Scan QR on VM: `./scripts/run-qr-scan.sh` or `set -a; source /etc/clawdbot/env; set +a; npm run dev`
5. Deploy with systemd (`systemd/clawdbot-gateway.service`)
6. Verify end-to-end: send WhatsApp message → Hot Bags receives → reply appears once

See [docs/DEPLOYMENT.md](../DEPLOYMENT.md) for full deployment guide.
