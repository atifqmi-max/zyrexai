# ZyreX

ZyreX is a self-hosted AI chat platform with per-member accounts, an admin panel, and a customer support system. Built with Node.js, Express, SQLite, and Amazon Bedrock (Claude models).

## Features

- **Auth system**: register, login, logout, forgot/reset password
- **Email OTP verification** on registration and on login from a new device (1-minute resend cooldown)
- **Per-user chats**: create, rename, delete — each user only sees their own chats and data
- **AI chat** powered by Amazon Bedrock (Claude), with optional web search
- **Copy-to-clipboard** for AI-generated code blocks
- **File upload** (attach files/images to a chat) and **file generation** (download AI output as a file)
- **Admin panel** (`/admin.html`):
  - Dashboard: total visitors, total users, total chats, open support tickets
  - User management: search, view a user's chats, suspend / unsuspend / delete / recover
  - View and moderate (suspend/delete) any user's individual chats
  - Customer support ticket inbox
- **Suspended account flow**: a suspended user sees the reason on login plus a "Contact Support" option
- **One-click installer/manager** (`scripts/zyrex.sh`): install, uninstall, backup, restore, update — with zero data loss on update

## Requirements

- Ubuntu VPS (20.04+ recommended)
- Node.js 20+ (auto-installed by the script)
- An SMTP account for sending emails
- An AWS account with Bedrock access (Claude model enabled) and a Bedrock API key

## Quick Install (recommended)

SSH into your VPS as root, then run:

```bash
curl -o zyrex.sh https://raw.githubusercontent.com/atifqmi-max/zyrexai/main/scripts/zyrex.sh
chmod +x zyrex.sh
./zyrex.sh
```

You'll see a menu:

```
======================================
           ZyreX Manager
======================================
1. Install ZyreX
2. UnInstall ZyreX
3. Take Backup
4. Load Backup
5. Update ZyreX

0. Exit
======================================
```

### 1. Install ZyreX
- Asks for the **port** (default `7000`)
- Asks for your **domain** (point your DNS at the server first, or use a Cloudflare Tunnel — see below — and just press Enter to use the server's IP)
- Asks for the **admin panel email/password** you want to log into `/admin.html` with
- Asks for your **SMTP settings** (host, sender email, password, port) — used to send OTP/verification/reset emails
- Asks for your **AWS Bedrock region, API key (bearer token), and model ID** — used to power the AI chat
- All of the above is written straight into `.env` on the server — nothing is hardcoded in the repo, and nothing needs manual editing afterward
- Clones the repo, installs dependencies, and starts the app with `pm2` (auto-restarts on crash/reboot)

### 2. UnInstall ZyreX
Stops the app and removes everything. Asks for confirmation first.

### 3. Take Backup
Creates a `.tar.gz` in `/root` containing your database, uploads, generated files, and `.env` — nothing is lost. Download this file off the server to keep it safe.

### 4. Load Backup
Point it at a backup file (place it in `/root` first), pick a port/domain, and it restores everything on a fresh VPS.

### 5. Update ZyreX
Pulls the latest code from GitHub and restarts the app. Your database, uploads, and `.env` are untouched (they're `.gitignore`d, so `git pull`/`git reset` never touches them).

## Using a Cloudflare Tunnel (recommended for HTTPS without opening ports)

```bash
# on the VPS
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && mv cloudflared /usr/local/bin/
cloudflared tunnel login
cloudflared tunnel create zyrex
cloudflared tunnel route dns zyrex chat.yourdomain.com
cloudflared tunnel run --url http://localhost:7000 zyrex
```

Then set `DOMAIN=https://chat.yourdomain.com` in `.env` and restart: `pm2 restart zyrexai`.

## Manual setup (without the script)

```bash
git clone https://github.com/atifqmi-max/zyrexai.git
cd zyrexai
cp .env.example .env
nano .env   # fill in real values
npm install
node server.js
pm2 restart zyrexai --update-env
```

## Environment variables (`.env`)

| Variable | Description |
|---|---|
| `PORT` | Port the app listens on (default `7000`) |
| `DOMAIN` | Public URL used in emails (reset links, etc.) |
| `SESSION_SECRET` | Random string used to sign session cookies |
| `ADMIN_EMAIL` / `ADMIN_PASS` | Login for `/admin.html` |
| `EMAIL_HOST` / `EMAIL_USER` / `EMAIL_PASS` / `SMTP_PORT` | SMTP credentials used to send OTP/reset emails |
| `AWS_REGION` | AWS region for Bedrock, e.g. `us-east-1` |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key (bearer token) |
| `BEDROCK_MODEL_ID` | Bedrock model ID to use |

## Security notes

- `.env`, the SQLite database, `uploads/`, and `generated/` are all in `.gitignore` — they are never pushed to GitHub.
- Passwords are hashed with bcrypt; nothing is stored in plain text.
- Rotate your SMTP password and AWS Bedrock key immediately if they were ever pasted into a chat, ticket, or committed by mistake.
- The admin route is protected only by the login form — for production, also consider putting it behind a firewall rule or VPN, since it's a high-value target.

## Project structure

```
zyrexai/
  server.js            # app entrypoint
  db/db.js              # SQLite schema + connection
  routes/
    auth.js              # register/login/OTP/reset
    chat.js               # chats CRUD + AI + uploads + file generation
    support.js            # user-facing support tickets
    admin.js               # admin panel API
  public/                # frontend (vanilla HTML/CSS/JS)
  scripts/zyrex.sh        # one-click installer/manager
  .env.example
```

## License

Private project — all rights reserved by the repository owner.
