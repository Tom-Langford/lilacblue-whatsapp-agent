# Lilac Blue WhatsApp Agent (ClawdBot Gateway)

WhatsApp gateway that maintains a persistent WhatsApp Web session, queues inbound events to Hot Bags with retries, and sends outbound replies idempotently. Transport + reliability only; no business logic.

## Features

- **whatsapp-web.js** – Persistent session via LocalAuth (QR scan once, durable auth on disk)
- **Hot Bags bridge** – POST inbound events with Bearer + HMAC auth, Idempotency-Key (message_id)
- **Durable queue** – SQLite with PENDING/PROCESSING/RETRY/DONE, infinite retries with max delay
- **Idempotent outbound** – No duplicate WhatsApp sends; command_id deduplication
- **Crash recovery** – Stale PROCESSING jobs reset on startup

## Requirements

- Node.js 20+
- Chromium dependencies for headless (see below)

## Chromium (headless VM)

On minimal Ubuntu/Oracle VM, install Chromium deps:

```bash
apt install -y libgbm1 libasound2 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxshmfence1
```

If bundled Chromium fails, install system Chromium and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in your env. Supported in `src/whatsapp/client.ts`. If using Volta/NVM, ensure `/usr/bin/node` exists or update the systemd ExecStart path.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env: HOTBAGS_INGEST_URL, HOTBAGS_BEARER_TOKEN, HOTBAGS_HMAC_SECRET,
   # QUEUE_DB_PATH, DATA_DIR, GATEWAY_INSTANCE_ID, ALLOWED_PHONE_NUMBERS
   ```

3. **First run – link WhatsApp**

   ```bash
   npm run dev
   ```

   Scan the QR code with WhatsApp. Auth is stored under `DATA_DIR/wwebjs_auth/`. Keep this directory backed up.

4. **Build and run**

   ```bash
   npm run build
   npm start
   ```

## Production deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for VM deployment: `npm ci`, `/etc/clawdbot/env`, QR scan on VM with `source`, systemd.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `HOTBAGS_INGEST_URL` | Yes | Hot Bags inbound endpoint URL |
| `HOTBAGS_BEARER_TOKEN` | Yes | Bearer token (align name with Hot Bags) |
| `HOTBAGS_HMAC_SECRET` | Yes* | HMAC secret. *Required unless `HOTBAGS_HMAC_DISABLED=true` (temporary Bearer-only; logs warning). |
| `HOTBAGS_HMAC_DISABLED` | No | Set to `true` for temporary Bearer-only mode; logs warning on startup. |
| `QUEUE_DB_PATH` | Yes | Path to SQLite queue DB (e.g. `$DATA_DIR/queue.db`) |
| `DATA_DIR` | Yes | Base for WhatsApp session + media |
| `GATEWAY_INSTANCE_ID` | Yes | Unique instance identifier |
| `ALLOWED_PHONE_NUMBERS` | Yes | Comma-separated phone numbers the bot will respond to (e.g. `+447584662710,+447887409934`). Group chats and other numbers are ignored. |
| `PUPPETEER_EXECUTABLE_PATH` | No | System Chromium path (if bundled fails on minimal VM) |

## Production (systemd)

Deploy to `/opt/clawdbot/lilacblue-whatsapp-agent` (or update paths in the unit file). **Use `/etc/clawdbot/env` for production; do not use repo `.env`.**

```bash
sudo cp systemd/clawdbot-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clawdbot-gateway
```

Create `/etc/clawdbot/env` with required variables. Use `npm ci` (not `npm install`) for reproducible builds. Prefer scanning QR on the VM; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Data

- `queue.db` – SQLite: inbound queue, outbound_sent (idempotency)
- `DATA_DIR/wwebjs_auth/` – WhatsApp session (back up for re-login)
- `DATA_DIR/media/` – Downloaded media (local_path for outbound only)

## Re-scan QR

If logged out, delete `DATA_DIR/wwebjs_auth/` and run again to show a new QR code.
