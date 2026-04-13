# Deploy Spec — beta-mvp (HostGator VPS / Ubuntu)

**Target environment**: HostGator VPS
**OS**: Ubuntu (22.04 LTS or 24.04 LTS)
**Access**: root
**Runtime**: Node.js 22 LTS (project uses `@types/node: ^22`)
**Node version manager**: [fnm](https://github.com/Schniz/fnm) (Fast Node Manager, popularized by Vercel)
**Process manager**: PM2
**Reverse proxy**: nginx
**TLS**: Let's Encrypt via certbot
**DB**: SQLite (embedded via `better-sqlite3`) — no DB server required

---

## 1. Versions (pinned)

| Tool        | Version     | Why pinned                                       |
| ----------- | ----------- | ------------------------------------------------ |
| Node.js     | `22.11.0`   | Current LTS ("Jod"); matches `@types/node: ^22` |
| npm         | `10.9.0`    | Ships bundled with Node 22.11.0                  |
| fnm         | `1.38.1`    | Latest stable at time of writing                 |
| PM2         | `5.4.x`     | Production process manager                       |

> Update this table whenever bumping versions. The project's Node version is also pinned in `.node-version` (created in step 4).

---

## 2. Pre-flight (run as root)

```bash
# System update
apt update && apt upgrade -y

# Base tooling
apt install -y curl git build-essential unzip ca-certificates gnupg \
  ufw fail2ban nginx sqlite3
```

---

## 3. Create a non-root deploy user

**Never run Node in production as root.** Create a dedicated user:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Switch to deploy user for the rest of the setup
su - deploy
```

From here on, all commands run as `deploy` unless noted with `# as root`.

---

## 4. Install fnm + Node.js 22 LTS

fnm is installed per-user (into `~/.local/share/fnm`). No `apt` package — install via the official script:

```bash
# As deploy user
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell

# Wire fnm into shell (adds to ~/.bashrc)
cat >> ~/.bashrc <<'EOF'

# fnm
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --use-on-cd --shell bash)"
EOF

# Reload shell
source ~/.bashrc

# Verify
fnm --version    # expect 1.38.x

# Install pinned Node version
fnm install 22.11.0
fnm default 22.11.0
fnm use 22.11.0

# Verify
node --version   # v22.11.0
npm --version    # 10.9.0
```

### 4.1 Pin Node version in the repo

```bash
cd /var/www/cafe-x-agent   # after step 5
echo "22.11.0" > .node-version
```

`fnm use` inside the project directory will auto-switch to this version (`--use-on-cd` enabled above).

---

## 5. Clone & install the app

```bash
# As root — create target dir owned by deploy
# as root
mkdir -p /var/www
chown deploy:deploy /var/www

# Back as deploy
cd /var/www
git clone <REPO_URL> cafe-x-agent
cd cafe-x-agent
git checkout feature/beta   # or the release branch

# Install deps (production only on server)
npm ci --omit=dev            # if you build locally/CI
# OR install everything + build on server:
npm ci
npm run build
```

---

## 6. Environment variables

```bash
cp .env.example .env   # if you don't have one, create manually
chmod 600 .env
nano .env
```

Required keys (see `src/config/*`): Anthropic API key, X API v2 credentials (publish-only), Telegram bot token + whitelist, RSS feeds, SQLite path, etc.

**Nunca** commitees `.env`. Ya está en `.gitignore` — verificalo.

---

## 7. PM2 as process manager

```bash
# Install PM2 globally in the fnm-managed Node
npm install -g pm2@5

# Start the app
cd /var/www/cafe-x-agent
pm2 start dist/main.js --name cafe-x-agent --time

# Save process list so it resurrects on reboot
pm2 save

# Generate systemd unit (outputs a sudo command — run it)
pm2 startup systemd -u deploy --hp /home/deploy
# Copy the sudo command it prints and run as root
```

Useful ops:

```bash
pm2 status
pm2 logs cafe-x-agent
pm2 restart cafe-x-agent
pm2 reload cafe-x-agent        # zero-downtime
pm2 monit
```

---

## 8. nginx reverse proxy

The NestJS app listens on some port (default `3000`). nginx terminates TLS and proxies to it.

```bash
# as root
cat > /etc/nginx/sites-available/cafe-x-agent <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }
}
EOF

ln -s /etc/nginx/sites-available/cafe-x-agent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

---

## 9. TLS with certbot (Let's Encrypt)

```bash
# as root
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com --non-interactive --agree-tos -m you@example.com

# Auto-renewal timer is installed by default; verify:
systemctl list-timers | grep certbot
```

---

## 10. Firewall (UFW)

```bash
# as root
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

---

## 11. Log rotation for PM2

```bash
# as deploy
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

---

## 12. SQLite backup (cron)

```bash
# as deploy
mkdir -p ~/backups
crontab -e
```

Add:

```
# Daily backup of SQLite DB at 03:00
0 3 * * * sqlite3 /var/www/cafe-x-agent/data/cafe-x-agent.db ".backup '/home/deploy/backups/cafe-x-agent-$(date +\%F).db'" && find /home/deploy/backups -type f -mtime +14 -delete
```

Ajustá el path del `.db` al que uses en `.env`.

---

## 13. Deploy / update flow

```bash
# as deploy
cd /var/www/cafe-x-agent
git pull
fnm use                 # auto-switches to .node-version
npm ci
npm run build
pm2 reload cafe-x-agent # zero-downtime
```

---

## 14. Health check

```bash
curl -s https://your-domain.com/health | jq
```

Expected: `{"status":"ok", ...}` (ver `src/health/health.controller.ts`).

---

## 15. Rollback

```bash
cd /var/www/cafe-x-agent
git log --oneline -10
git checkout <previous-sha>
npm ci && npm run build
pm2 reload cafe-x-agent
```

Para la DB, restaurar desde `~/backups/`.

---

## Appendix A — Why fnm and not nvm / apt

- **nvm** is shell-function-based and slow on shell startup (sources a huge bash script). fnm is a single Rust binary, instant.
- **`apt install nodejs`** pulls whatever version Ubuntu's repo has — often outdated and no easy way to pin. NodeSource fixes that but still can't manage multiple versions.
- **fnm** gives you: pinned version via `.node-version`, per-project auto-switch, fast shell, zero global state conflicts.

## Appendix B — Why PM2 and not bare systemd

PM2 can coexist with systemd (step 7 registers PM2 as a systemd unit). PM2 adds: log aggregation, zero-downtime reloads, cluster mode, monitoring CLI. For a single-process NestJS app this is overkill-lite but the ergonomics pay off.

If you want pure systemd instead, ask — te armo la unit file.
