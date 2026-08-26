#!/bin/bash
# =========================================================
# ZyreX - One-Click Installer / Manager
# Usage: bash zyrex.sh   (or ./zyrex.sh after chmod +x)
# =========================================================

set -e

APP_DIR="/root/zyrexai"
REPO_URL="https://github.com/atifqmi-max/zyrexai.git"
BACKUP_DIR="/root"
SERVICE_NAME="zyrexai"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; }

ensure_prereqs() {
  if ! command -v node >/dev/null 2>&1; then
    info "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  if ! command -v git >/dev/null 2>&1; then
    apt-get install -y git
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    info "Installing pm2 process manager..."
    npm install -g pm2
  fi
}

write_env() {
  local port=$1
  local domain=$2

  echo ""
  warn "Admin panel credentials (used to log into /admin.html) - NOT stored in GitHub, only on this server:"
  read -p "Admin email: " ADMIN_EMAIL_IN
  read -s -p "Admin password: " ADMIN_PASS_IN
  echo ""

  echo ""
  warn "Email (SMTP) settings - used to send OTP / verification / reset emails:"
  read -p "SMTP host (e.g. host3.xhost.co.in): " SMTP_HOST_IN
  read -p "SMTP sender email (e.g. no-reply@yourdomain.com): " SMTP_USER_IN
  read -s -p "SMTP password: " SMTP_PASS_IN
  echo ""
  read -p "SMTP port [default 465]: " SMTP_PORT_IN
  SMTP_PORT_IN=${SMTP_PORT_IN:-465}

  echo ""
  warn "AWS Bedrock settings - used to power the AI chat:"
  read -p "AWS region [default us-east-1]: " AWS_REGION_IN
  AWS_REGION_IN=${AWS_REGION_IN:-us-east-1}
  read -s -p "AWS Bedrock API key (bearer token): " AWS_TOKEN_IN
  echo ""
  read -s -p "Backup AWS Bedrock API key (optional, press Enter to skip): " AWS_TOKEN_2_IN
  echo ""
  read -p "Bedrock model ID [default anthropic.claude-3-5-sonnet-20241022-v2:0]: " MODEL_ID_IN
  MODEL_ID_IN=${MODEL_ID_IN:-anthropic.claude-3-5-sonnet-20241022-v2:0}

  echo ""
  warn "OpenAI backup (optional) - if AWS Bedrock ever fails completely, ZyreX automatically retries with OpenAI instead of showing an error. Press Enter to skip if you don't have one."
  read -s -p "OpenAI API key (starts with sk-...): " OPENAI_KEY_IN
  echo ""
  OPENAI_MODEL_IN="gpt-4o-mini"
  if [ -n "$OPENAI_KEY_IN" ]; then
    read -p "OpenAI model [default gpt-4o-mini]: " OPENAI_MODEL_INPUT
    OPENAI_MODEL_IN=${OPENAI_MODEL_INPUT:-gpt-4o-mini}
  fi

  # IMPORTANT: use printf (not an unquoted heredoc) so that special shell
  # characters in passwords/keys ($ ` \ etc) are written literally instead
  # of being expanded/corrupted by bash.
  local SESSION_SECRET_VAL
  SESSION_SECRET_VAL=$(openssl rand -hex 32)
  {
    printf 'PORT=%s\n' "$port"
    printf 'DOMAIN=%s\n' "$domain"
    printf 'SESSION_SECRET=%s\n\n' "$SESSION_SECRET_VAL"

    printf 'ADMIN_EMAIL=%s\n' "$ADMIN_EMAIL_IN"
    printf 'ADMIN_PASS=%s\n\n' "$ADMIN_PASS_IN"

    printf 'EMAIL_HOST=%s\n' "$SMTP_HOST_IN"
    printf 'EMAIL_USER=%s\n' "$SMTP_USER_IN"
    printf 'EMAIL_PASS=%s\n' "$SMTP_PASS_IN"
    printf 'SMTP_PORT=%s\n' "$SMTP_PORT_IN"
    printf 'IMAP_PORT=993\n\n'

    printf 'AWS_REGION=%s\n' "$AWS_REGION_IN"
    printf 'AWS_BEARER_TOKEN_BEDROCK=%s\n' "$AWS_TOKEN_IN"
    if [ -n "$AWS_TOKEN_2_IN" ]; then
      printf 'AWS_BEARER_TOKEN_BEDROCK_2=%s\n' "$AWS_TOKEN_2_IN"
    fi
    printf 'BEDROCK_MODEL_ID=%s\n\n' "$MODEL_ID_IN"

    if [ -n "$OPENAI_KEY_IN" ]; then
      printf 'OPENAI_API_KEY=%s\n' "$OPENAI_KEY_IN"
      printf 'OPENAI_MODEL=%s\n' "$OPENAI_MODEL_IN"
    fi
  } > "$APP_DIR/.env"
  info "All settings saved to $APP_DIR/.env"
}

install_zyrex() {
  ensure_prereqs

  read -p "Enter the port to run ZyreX on [default 7000]: " PORT
  PORT=${PORT:-7000}

  echo ""
  warn "Point your domain's DNS (A record or Cloudflare Tunnel) at this server before continuing."
  read -p "Enter your domain (e.g. https://chat.yourdomain.com) or press Enter to use http://SERVER_IP:$PORT : " DOMAIN
  if [ -z "$DOMAIN" ]; then
    SERVER_IP=$(curl -s ifconfig.me || echo "your-server-ip")
    DOMAIN="http://${SERVER_IP}:${PORT}"
  fi

  if [ -d "$APP_DIR" ]; then
    warn "$APP_DIR already exists. Pulling latest instead of a fresh clone."
    cd "$APP_DIR" && git pull
  else
    info "Cloning ZyreX repository..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi

  mkdir -p "$APP_DIR/db" "$APP_DIR/uploads" "$APP_DIR/generated"

  if [ ! -f "$APP_DIR/.env" ]; then
    write_env "$PORT" "$DOMAIN"
  else
    warn "Existing .env found, keeping it."
  fi

  info "Installing dependencies..."
  cd "$APP_DIR" && npm install --omit=dev

  info "Starting ZyreX with pm2 on port $PORT..."
  pm2 start server.js --name "$SERVICE_NAME" --env production 2>/dev/null || pm2 restart "$SERVICE_NAME"
  pm2 save
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

  echo ""
  info "ZyreX installed successfully!"
  info "App URL: $DOMAIN"
  info "Admin panel: $DOMAIN/admin.html"
  warn "Tip: for HTTPS + a real domain without opening firewall ports, use a Cloudflare Tunnel:"
  echo "     cloudflared tunnel --url http://localhost:$PORT"
}

uninstall_zyrex() {
  read -p "This will permanently delete ZyreX and ALL data. Type YES to confirm: " CONFIRM
  if [ "$CONFIRM" != "YES" ]; then
    warn "Cancelled."
    return
  fi
  pm2 delete "$SERVICE_NAME" 2>/dev/null || true
  pm2 save 2>/dev/null || true
  rm -rf "$APP_DIR"
  info "ZyreX has been uninstalled."
}

take_backup() {
  if [ ! -d "$APP_DIR" ]; then error "ZyreX is not installed."; return; fi
  TS=$(date +%Y%m%d-%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/zyrex-backup-$TS.tar.gz"
  info "Creating backup..."
  tar -czf "$BACKUP_FILE" \
    -C "$APP_DIR" db uploads generated .env
  info "Backup created: $BACKUP_FILE"
  info "Download this file from the server's root folder to keep it safe."
}

load_backup() {
  read -p "Enter the full path to the backup .tar.gz file (place it in /root first): " BFILE
  if [ ! -f "$BFILE" ]; then error "File not found: $BFILE"; return; fi

  ensure_prereqs

  read -p "Enter the port to run ZyreX on [default 7000]: " PORT
  PORT=${PORT:-7000}
  read -p "Enter your domain (or press Enter to use http://SERVER_IP:$PORT): " DOMAIN
  if [ -z "$DOMAIN" ]; then
    SERVER_IP=$(curl -s ifconfig.me || echo "your-server-ip")
    DOMAIN="http://${SERVER_IP}:${PORT}"
  fi

  if [ ! -d "$APP_DIR" ]; then
    info "Cloning ZyreX repository..."
    git clone "$REPO_URL" "$APP_DIR"
  fi

  info "Restoring backup data (db, uploads, generated, .env)..."
  tar -xzf "$BFILE" -C "$APP_DIR"

  # Override port/domain from the restored .env with the values chosen now
  sed -i "s|^PORT=.*|PORT=${PORT}|" "$APP_DIR/.env"
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" "$APP_DIR/.env"

  cd "$APP_DIR" && npm install --omit=dev
  pm2 start server.js --name "$SERVICE_NAME" --env production 2>/dev/null || pm2 restart "$SERVICE_NAME"
  pm2 save
  info "Backup restored and ZyreX is running at $DOMAIN"
}

update_zyrex() {
  if [ ! -d "$APP_DIR" ]; then error "ZyreX is not installed."; return; fi
  info "Pulling latest changes from GitHub (your data in db/, uploads/, generated/, .env is untouched - those are gitignored)..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
  npm install --omit=dev
  pm2 restart "$SERVICE_NAME"
  info "ZyreX updated to the latest version with zero data loss."
}

connect_domain() {
  if [ ! -d "$APP_DIR" ]; then error "ZyreX is not installed."; return; fi
  if [ ! -f "$APP_DIR/.env" ]; then error "No .env found. Run Install first."; return; fi

  echo ""
  warn "Make sure your domain's DNS (A record) or Cloudflare Tunnel already points to this server before continuing."
  read -p "Enter the new domain (e.g. https://chat.yourdomain.com): " NEW_DOMAIN
  if [ -z "$NEW_DOMAIN" ]; then
    warn "No domain entered. Cancelled."
    return
  fi

  sed -i "s|^DOMAIN=.*|DOMAIN=${NEW_DOMAIN}|" "$APP_DIR/.env"
  pm2 restart "$SERVICE_NAME" --update-env
  info "Domain updated. ZyreX is now serving at: $NEW_DOMAIN"
  warn "If this is a fresh domain, remember to also add it in Cloudflare (or your DNS provider) and, if using a Cloudflare Tunnel, run:"
  echo "     cloudflared tunnel route dns <your-tunnel-name> <your-new-domain>"
}

show_menu() {
  echo ""
  echo "======================================"
  echo "           ZyreX Manager"
  echo "======================================"
  echo "1. Install ZyreX"
  echo "2. UnInstall ZyreX"
  echo "3. Take Backup"
  echo "4. Load Backup"
  echo "5. Update ZyreX"
  echo "6. Connect New Domain"
  echo ""
  echo "0. Exit"
  echo "======================================"
  read -p "Select an option: " OPT
  case $OPT in
    1) install_zyrex ;;
    2) uninstall_zyrex ;;
    3) take_backup ;;
    4) load_backup ;;
    5) update_zyrex ;;
    6) connect_domain ;;
    0) exit 0 ;;
    *) error "Invalid option" ;;
  esac
}

while true; do
  show_menu
done
