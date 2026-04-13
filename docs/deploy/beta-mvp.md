# Spec de Deploy — beta-mvp (VPS HostGator / Ubuntu)

**Entorno destino**: VPS de HostGator
**SO**: Ubuntu (22.04 LTS o 24.04 LTS)
**Acceso**: root
**Runtime**: Node.js 22 LTS (el proyecto usa `@types/node: ^22`)
**Gestor de versiones de Node**: [fnm](https://github.com/Schniz/fnm) (Fast Node Manager, popularizado por Vercel)
**Process manager**: PM2
**Reverse proxy**: nginx
**TLS**: Let's Encrypt via certbot
**DB**: SQLite (embebida via `better-sqlite3`) — no hace falta servidor de base de datos

---

## 1. Versiones (pineadas)

| Herramienta | Versión     | Por qué pineada                                     |
| ----------- | ----------- | --------------------------------------------------- |
| Node.js     | `22.11.0`   | LTS actual ("Jod"); coincide con `@types/node: ^22` |
| npm         | `10.9.0`    | Viene bundled con Node 22.11.0                      |
| fnm         | `1.38.1`    | Último estable al momento de escribir esto          |
| PM2         | `5.4.x`     | Process manager de producción                       |

> Actualizá esta tabla cada vez que bumpees versiones. La versión de Node del proyecto también queda pineada en `.node-version` (se crea en el paso 5.3).

---

## 2. Pre-flight (correr como root)

**Explicación**: Antes de instalar nada, actualizamos el sistema y metemos las herramientas base que vamos a necesitar en los próximos pasos.

```bash
# Actualización del sistema
apt update && apt upgrade -y

# Herramientas base
apt install -y curl git build-essential unzip ca-certificates gnupg \
  ufw fail2ban nginx sqlite3
```

**Qué instala cada cosa**:
- `curl`, `git` — obvio
- `build-essential` — compiladores C/C++ (los necesita `better-sqlite3` al instalarse)
- `ufw` — firewall
- `fail2ban` — bloquea IPs que intentan fuerza bruta SSH
- `nginx` — reverse proxy
- `sqlite3` — CLI para inspeccionar/backup la DB

---

## 3. Crear usuario deploy (no-root)

**Regla de oro**: **nunca** corras Node en producción como root. Si la app tiene una vulnerabilidad, el atacante hereda los permisos del proceso — y root puede con TODO. Un usuario dedicado limita el daño.

```bash
# Crear usuario sin password (login solo por SSH key)
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Copiar tu clave SSH de root al usuario deploy para poder loguearte directo
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Cambiar al usuario deploy para el resto del setup
su - deploy
```

De acá en adelante, todos los comandos corren como `deploy` salvo que diga `# como root`.

---

## 4. Instalar fnm + Node.js 22 LTS

**Explicación**: fnm se instala por-usuario (en `~/.local/share/fnm`). No hay paquete `apt` oficial — se instala via script oficial:

```bash
# Como usuario deploy
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell

# Conectar fnm al shell (agrega líneas a ~/.bashrc)
cat >> ~/.bashrc <<'EOF'

# fnm
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --use-on-cd --shell bash)"
EOF

# Recargar shell
source ~/.bashrc

# Verificar
fnm --version    # esperás 1.38.x

# Instalar la versión pineada de Node
fnm install 22.11.0
fnm default 22.11.0
fnm use 22.11.0

# Verificar
node --version   # v22.11.0
npm --version    # 10.9.0
```

**Qué hace `--use-on-cd`**: cada vez que hagas `cd` a un directorio con `.node-version`, fnm cambia automáticamente a esa versión. Magia.

> **Nota**: El `.node-version` que fija la versión del proyecto se crea recién en el paso 5.3, **después** de clonar el repo. Acá solo instalaste Node a nivel usuario `deploy`.

---

## 5. Clonar e instalar la app

### 5.1 Preparar el directorio destino

**Explicación**: `/var/www/` es el directorio estándar en Linux para hostear aplicaciones web. Lo creamos como `root` y le damos ownership al usuario `deploy` para que pueda escribir sin sudo.

```bash
# Como root — salí de la sesión de deploy primero (Ctrl+D o `exit`)
exit   # volvés a root

# Crear el directorio padre y pasarle ownership a deploy
mkdir -p /var/www
chown deploy:deploy /var/www

# Volver al usuario deploy para el resto
su - deploy
```

### 5.2 Configurar clave SSH para GitHub

**Explicación**: Para clonar y hacer `git pull` desde el VPS usando SSH (en vez de HTTPS con token o password), GitHub necesita reconocer al VPS. Generamos un par de claves (privada en el VPS, pública en GitHub) y GitHub confía en cualquiera que firme con la privada.

**¿Por qué SSH y no HTTPS?**
- No tenés que guardar un Personal Access Token en el VPS (menos superficie de ataque).
- No tenés que meter password cada vez que hacés `git pull`.
- Es el estándar en servidores de producción.

#### 5.2.1 Generar el par de claves

```bash
# Como deploy — generar clave ed25519 (más moderna y corta que RSA)
ssh-keygen -t ed25519 -C "deploy@cafe-x-agent-vps" -f ~/.ssh/id_ed25519_github -N ""
```

**Qué hace cada flag**:
- `-t ed25519` → tipo de clave (moderno, recomendado por GitHub)
- `-C "..."` → comentario identificatorio (va al final del archivo `.pub`)
- `-f ~/.ssh/id_ed25519_github` → nombre del archivo (así no pisa otra clave si ya tenés una)
- `-N ""` → sin passphrase (para que pueda usarse en automatizaciones sin pedir password)

Esto crea dos archivos:
- `~/.ssh/id_ed25519_github` → **clave privada** (NUNCA la compartas, NUNCA la commitees)
- `~/.ssh/id_ed25519_github.pub` → **clave pública** (esta va a GitHub)

#### 5.2.2 Configurar SSH para usar esta clave con GitHub

**Explicación**: Le decimos al cliente SSH: "cuando te conectes a `github.com`, usá esta clave específica". Útil si mañana tenés varias claves para distintos servicios.

```bash
cat >> ~/.ssh/config <<'EOF'

Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
```

#### 5.2.3 Copiar la clave pública a GitHub

```bash
# Mostrar la clave pública para copiarla
cat ~/.ssh/id_ed25519_github.pub
```

Copiá toda la salida (empieza con `ssh-ed25519 ...` y termina con el comentario `deploy@cafe-x-agent-vps`).

En GitHub:
1. Andá a **Settings** → **SSH and GPG keys** → **New SSH key**
   (URL directa: https://github.com/settings/keys)
2. **Title**: algo descriptivo como `cafe-x-agent-vps (hostgator)`
3. **Key type**: `Authentication Key`
4. **Key**: pegá el contenido que copiaste
5. Click en **Add SSH key**

#### 5.2.4 Probar la conexión

```bash
ssh -T git@github.com
```

Primera vez te va a pedir confirmar la fingerprint — escribí `yes` y enter.

**Respuesta esperada**:
```
Hi <tu-usuario>! You've successfully authenticated, but GitHub does not provide shell access.
```

Ese mensaje **es correcto** aunque diga "does not provide shell access" — GitHub no te da shell, solo git. Autenticación OK.

Si te tira `Permission denied (publickey)`, revisá:
- Que la clave pública esté bien pegada en GitHub (sin saltos de línea cortando)
- Que el archivo `~/.ssh/config` tenga permisos 600

### 5.3 Clonar el repositorio

**Ahora sí**, usá la URL SSH del repo (no la HTTPS):

```bash
cd /var/www
git clone git@github.com:<tu-usuario>/cafe-x-agent.git
cd cafe-x-agent
git checkout feature/beta   # o la rama de release que corresponda
```

**Diferencia de URL**:
- HTTPS: `https://github.com/usuario/cafe-x-agent.git` → pide user/password o PAT
- SSH: `git@github.com:usuario/cafe-x-agent.git` → usa la clave SSH que acabamos de configurar

**Explicación**: `git clone <URL> cafe-x-agent` crea la carpeta `/var/www/cafe-x-agent` y descarga el código ahí. Recién AHORA existe la carpeta del proyecto — por eso antes no podías hacer `cd` ahí.

### 5.4 Pinear la versión de Node en el repo

**Explicación**: Este archivo le dice a fnm: "cuando entres a este proyecto, usá Node 22.11.0". Así, cualquier máquina (tu Mac, este VPS, el de un compañero) corre la **misma versión** sin tener que acordarse.

```bash
# Ya estás dentro de /var/www/cafe-x-agent
echo "22.11.0" > .node-version

# Verificá que fnm lo tome
fnm use
node --version   # debe decir v22.11.0
```

> Si el proyecto ya trae `.node-version` commiteado en el repo, este paso es redundante — pero no hace daño ejecutarlo.

### 5.5 Instalar dependencias y compilar

**Explicación**:
- `npm ci` instala **exactamente** las versiones que dice `package-lock.json` (más rápido y reproducible que `npm install`).
- `npm run build` compila el TypeScript a JavaScript en la carpeta `dist/`. Node no corre TS directamente en producción.

```bash
npm ci
npm run build
```

**Verificá que se haya creado `dist/main.js`** — es el archivo que va a ejecutar PM2 en el paso 7:

```bash
ls -la dist/main.js
```

---

## 6. Variables de entorno

**Explicación**: El `.env` guarda los secretos (API keys, tokens) que NO van al repo. NestJS los lee via `@nestjs/config` al arrancar.

```bash
# Estando en /var/www/cafe-x-agent como deploy
cp .env.example .env      # si existe el example; si no, creá uno vacío con `nano .env`
chmod 600 .env            # permisos restrictivos: solo deploy puede leerlo
nano .env                 # editá y pegá tus claves
```

**Claves requeridas** (ver `src/config/*`):
- `ANTHROPIC_API_KEY` — Claude API
- `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` — credenciales de X (publish-only)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WHITELIST` — bot de Telegram + users autorizados
- `RSS_FEEDS` — feeds separados por coma
- `DATABASE_PATH` — ruta absoluta al `.db` (ej: `/var/www/cafe-x-agent/data/cafe-x-agent.db`)
- `PORT` — puerto HTTP (default 3000)

**Nunca** commitees `.env`. Ya está en `.gitignore` — verificalo con `cat .gitignore | grep .env`.

**Importante**: creá el directorio de la DB antes de arrancar la app:

```bash
mkdir -p /var/www/cafe-x-agent/data
```

---

## 7. PM2 como process manager

**Explicación**: Node por sí solo NO sabe reiniciarse si se cae, ni arrancar cuando bootea el servidor. PM2 es un "process manager" que hace eso y más: logs centralizados, reload sin downtime, auto-restart si crashea.

```bash
# Como deploy — instalar PM2 global (dentro del Node que maneja fnm)
npm install -g pm2@5

# Arrancar la app apuntando al JS compilado (no al TS)
cd /var/www/cafe-x-agent
pm2 start dist/main.js --name cafe-x-agent --time

# Guardar la lista de procesos para que se restauren en reboot
pm2 save

# Registrar PM2 como servicio de systemd (para que arranque solo)
pm2 startup systemd -u deploy --hp /home/deploy
# ☝️ Este comando TE IMPRIME en pantalla un `sudo ...` — copialo y ejecutalo como root
```

**Qué hace cada cosa**:
- `pm2 start` → arranca el proceso ahora
- `pm2 save` → persiste la lista de procesos actuales a disco
- `pm2 startup` → genera el systemd unit que, en el próximo boot, llama a `pm2 resurrect` con esa lista guardada

Operaciones útiles:

```bash
pm2 status                     # ver estado
pm2 logs cafe-x-agent          # ver logs en vivo
pm2 restart cafe-x-agent       # reinicio duro
pm2 reload cafe-x-agent        # reload sin downtime
pm2 monit                      # monitor interactivo CPU/RAM
```

---

## 8. nginx como reverse proxy

**Explicación**: Tu app Node escucha en el puerto `3000` (localhost). Pero internet espera HTTP en el puerto `80` y HTTPS en el `443`. Nginx se para adelante, recibe el tráfico de internet, maneja HTTPS/TLS, y le pasa el request a Node. Esto se llama **reverse proxy**.

**¿Por qué no hacer que Node escuche directamente en el 80/443?**
1. Los puertos <1024 requieren root (inseguro correr Node como root).
2. Nginx es infinitamente más eficiente sirviendo assets estáticos, manejando HTTPS, comprimiendo, cacheando, rate-limiting.
3. Si querés varios servicios en el mismo VPS (API + frontend + otro), nginx los rutea por dominio.

```bash
# Como root
cat > /etc/nginx/sites-available/cafe-x-agent <<'EOF'
server {
    listen 80;
    server_name tu-dominio.com;

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

# Activar el sitio (symlink a sites-enabled)
ln -s /etc/nginx/sites-available/cafe-x-agent /etc/nginx/sites-enabled/

# Eliminar el sitio default que viene con Ubuntu
rm -f /etc/nginx/sites-enabled/default

# Validar sintaxis antes de aplicar
nginx -t

# Aplicar cambios sin downtime
systemctl reload nginx
```

**Ojo**: reemplazá `tu-dominio.com` por tu dominio real ANTES de correr esto.

---

## 9. TLS con certbot (Let's Encrypt)

**Explicación**: Certbot automatiza la obtención y renovación de certificados SSL gratuitos de Let's Encrypt. Modifica tu config de nginx para habilitar HTTPS y redirige HTTP → HTTPS.

```bash
# Como root
apt install -y certbot python3-certbot-nginx

# Obtener el certificado y configurar nginx automáticamente
certbot --nginx -d tu-dominio.com --non-interactive --agree-tos -m tu-email@ejemplo.com

# El timer de auto-renovación se instala por default; verificalo:
systemctl list-timers | grep certbot
```

**Qué hace el `--nginx`**: certbot detecta tu config, agrega el bloque SSL, redirige 80→443, y recarga nginx. Todo en un comando.

---

## 10. Firewall (UFW)

**Explicación**: UFW (Uncomplicated Firewall) cierra TODOS los puertos salvo los que explícitamente permitas. Sin esto, cualquier servicio que levantes queda expuesto al mundo.

```bash
# Como root
ufw default deny incoming         # bloquear todo el tráfico entrante
ufw default allow outgoing        # permitir todo el tráfico saliente
ufw allow OpenSSH                 # dejar SSH abierto (si no, te quedás sin acceso)
ufw allow 'Nginx Full'            # abrir puertos 80 y 443
ufw enable                        # activar el firewall
ufw status                        # verificar reglas aplicadas
```

**CUIDADO**: si te olvidás de `ufw allow OpenSSH` antes de `ufw enable`, **te quedás afuera del VPS**. HostGator tiene consola web por si eso pasa, pero evitémoslo.

---

## 11. Rotación de logs de PM2

**Explicación**: Sin rotación, los logs crecen para siempre hasta llenar el disco. `pm2-logrotate` rota automáticamente.

```bash
# Como deploy
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M       # rotar cuando pase de 10 MB
pm2 set pm2-logrotate:retain 14          # mantener 14 archivos históricos
pm2 set pm2-logrotate:compress true      # comprimir los rotados (gzip)
```

---

## 12. Backup de SQLite (cron)

**Explicación**: SQLite es un archivo. Si se corrompe o lo borrás por accidente, perdés toda la data (profile summary, tweets generados, feedback). Este cron hace un backup diario y mantiene 14 días.

**Por qué `sqlite3 .backup` y no `cp`**: si copiás el archivo mientras la DB está escribiendo, el backup queda corrupto. El comando `.backup` de sqlite3 hace una copia consistente incluso con la DB en uso.

```bash
# Como deploy
mkdir -p ~/backups
crontab -e
```

Agregá esta línea:

```
# Backup diario de SQLite a las 03:00
0 3 * * * sqlite3 /var/www/cafe-x-agent/data/cafe-x-agent.db ".backup '/home/deploy/backups/cafe-x-agent-$(date +\%F).db'" && find /home/deploy/backups -type f -mtime +14 -delete
```

Ajustá el path del `.db` al que uses en `.env`.

**Verificá que el cron corrió**: al día siguiente hacé `ls -la ~/backups/` y deberías ver el archivo con la fecha.

---

## 13. Flujo de deploy / update

**Explicación**: Este es el flujo que vas a correr CADA VEZ que quieras subir cambios nuevos al VPS. Memorízalo.

```bash
# Como deploy
cd /var/www/cafe-x-agent
git pull                    # bajar cambios del repo
fnm use                     # auto-switch a la versión de .node-version
npm ci                      # instalar deps (si package-lock.json cambió)
npm run build               # recompilar TS → dist/
pm2 reload cafe-x-agent     # reload sin downtime
```

**`reload` vs `restart`**: `reload` levanta la nueva versión del proceso antes de matar la vieja → cero downtime. `restart` mata primero y levanta después → downtime corto pero hay.

---

## 14. Health check

**Explicación**: Verificá que la app está respondiendo. Si esto falla, algo está mal (Node crasheado, nginx mal configurado, firewall bloqueando, etc.).

```bash
curl -s https://tu-dominio.com/health | jq
```

Esperado: `{"status":"ok", ...}` (ver `src/health/health.controller.ts`).

Si no tenés `jq` instalado: `apt install -y jq` como root.

---

## 15. Rollback

**Explicación**: Si subiste algo que rompió prod, volvé a la versión anterior YA. Discutís después qué falló.

```bash
cd /var/www/cafe-x-agent
git log --oneline -10                  # ver últimos 10 commits
git checkout <sha-anterior>            # volver a un commit funcionando
npm ci && npm run build
pm2 reload cafe-x-agent
```

Para la DB, restaurar desde `~/backups/`:

```bash
# Detener la app primero para que no escriba mientras restaurás
pm2 stop cafe-x-agent
cp ~/backups/cafe-x-agent-YYYY-MM-DD.db /var/www/cafe-x-agent/data/cafe-x-agent.db
pm2 start cafe-x-agent
```

---

## Apéndice A — Por qué fnm y no nvm / apt

- **nvm** está basado en funciones de shell y es lento al iniciar el shell (carga un script bash enorme cada vez). fnm es un binario de Rust, instantáneo.
- **`apt install nodejs`** te da la versión que tenga el repo de Ubuntu — generalmente vieja y sin forma fácil de pinear. NodeSource lo arregla pero igual no te deja manejar múltiples versiones en paralelo.
- **fnm** te da: versión pineada via `.node-version`, auto-switch por proyecto, shell rápido, cero conflictos de estado global.

## Apéndice B — Por qué PM2 y no systemd puro

PM2 puede convivir con systemd (en el paso 7 registramos PM2 como unit de systemd). PM2 agrega: agregación de logs, reloads sin downtime, modo cluster, CLI de monitoreo. Para una app NestJS de un solo proceso es un poco overkill, pero la ergonomía compensa.

Si preferís systemd puro, decímelo — te armo el unit file.
