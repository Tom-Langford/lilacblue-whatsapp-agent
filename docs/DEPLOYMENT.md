# ClawdBot Gateway – Deployment Guide

## Overview

Two env contexts:

- **Local:** `.env` in repo root for `npm run dev`
- **Production (VM):** `/etc/clawdbot/env` for systemd (never use repo `.env` in production)

---

## 1. Local Setup

```bash
cp .env.example .env
# Edit .env with your values
npm install
npm run dev   # Scan QR; auth stored in DATA_DIR/wwebjs_auth/
```

---

## 2. VM Deployment

### Prerequisites

- Ubuntu 22.04 or 24.04
- Node.js 20+
- Chromium deps: `apt install -y libgbm1 libasound2 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libxshmfence1`

### Step 1: Clone and build

```bash
cd /opt/clawdbot
git clone <repo-url> lilacblue-whatsapp-agent
cd lilacblue-whatsapp-agent
npm ci
npm run build
```

Use `npm ci` (not `npm install`) for reproducible builds when `package-lock.json` exists.

### Step 2: Create production env file

Create `/etc/clawdbot/env` (systemd reads this; do not use repo `.env`):

```bash
sudo nano /etc/clawdbot/env
```

Include all variables. Use the same names in both gateway and Hot Bags (`HOTBAGS_BEARER_TOKEN` in both):

```
HOTBAGS_INGEST_URL=https://your-hotbags.vercel.app/api/integrations/whatsapp/inbound
HOTBAGS_BEARER_TOKEN=<same-value-as-hot-bags>
HOTBAGS_HMAC_SECRET=<shared-secret-with-hot-bags>
QUEUE_DB_PATH=/var/lib/clawdbot/queue.db
DATA_DIR=/var/lib/clawdbot
GATEWAY_INSTANCE_ID=clawdbot-1
ALLOWED_PHONE_NUMBERS=+447584662710,+447887409934,+447748630646,+447557790428
```

- `HOTBAGS_HMAC_SECRET`: Required for production. Use `HOTBAGS_HMAC_DISABLED=true` only for temporary Bearer-only mode (logs warning).
- `chmod 600 /etc/clawdbot/env`

### Step 3: Create data directory and user

```bash
sudo mkdir -p /var/lib/clawdbot
sudo useradd -r -s /bin/false clawdbot 2>/dev/null || true
sudo chown -R clawdbot:clawdbot /var/lib/clawdbot
sudo chown -R clawdbot:clawdbot /opt/clawdbot/lilacblue-whatsapp-agent
```

### Step 4: QR scan on the VM (recommended)

Scan on the VM so auth matches the production environment. Avoid copying `wwebjs_auth/` from local (ownership, paths, partial copies can cause issues).

Load production env safely with `source` (do not use `env $(cat ... | xargs)`):

```bash
cd /opt/clawdbot/lilacblue-whatsapp-agent
set -a
source /etc/clawdbot/env
set +a
npm run dev
```

Or use the helper script:

```bash
./scripts/run-qr-scan.sh
```

Scan the QR with WhatsApp. Stop the process (Ctrl+C) when "WhatsApp client ready" appears.

If running as root, fix ownership:

```bash
sudo chown -R clawdbot:clawdbot /var/lib/clawdbot
```

### Step 5: PUPPETEER_EXECUTABLE_PATH (if needed)

If bundled Chromium fails, install system Chromium and add to `/etc/clawdbot/env`:

```
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

This is supported in `src/whatsapp/client.ts`.

### Step 6: systemd

```bash
sudo cp systemd/clawdbot-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clawdbot-gateway
sudo systemctl status clawdbot-gateway
```

---

## 3. Updates (after git push)

```bash
cd /opt/clawdbot/lilacblue-whatsapp-agent
git pull
npm ci
npm run build
sudo systemctl restart clawdbot-gateway
```

---

## 4. Re-scan QR

If logged out:

```bash
sudo rm -rf /var/lib/clawdbot/wwebjs_auth
cd /opt/clawdbot/lilacblue-whatsapp-agent
set -a && source /etc/clawdbot/env && set +a && npm run dev
# Scan QR, then Ctrl+C
sudo chown -R clawdbot:clawdbot /var/lib/clawdbot
sudo systemctl restart clawdbot-gateway
```

---

## Checklist

| Step | Action |
|------|--------|
| 1 | Push repo to git |
| 2 | On VM: clone/pull, `npm ci`, `npm run build` |
| 3 | Create `/etc/clawdbot/env` with all vars (never use repo `.env` for production) |
| 4 | Create `DATA_DIR`, `clawdbot` user, set ownership |
| 5 | **Scan QR on VM** with `source /etc/clawdbot/env` + `npm run dev` |
| 6 | Install Chromium deps; add `PUPPETEER_EXECUTABLE_PATH` if needed |
| 7 | Install systemd service, enable, start |
