# Post-Deploy Checks — beta-mvp (HostGator VPS)

**Objetivo**: validar que toda la infraestructura del deploy `v1.0.0-beta` está sólida, segura, y lista para uso real.

**Cuándo correrlo**: al día siguiente del deploy inicial (o cada vez que cambies algo crítico de infra).

**Tiempo estimado**: 30-45 min la primera vez, ~10 min las siguientes.

> **Filosofía**: un deploy "up" no es lo mismo que un deploy "sólido". Un proceso puede estar vivo pero reiniciándose en loop, o respondiendo pero sin HTTPS, o sin backups. Estos checks te dan certeza REAL.

---

## Checklist rápido (TL;DR)

- [ ] §1 — App viva y estable (PM2)
- [ ] §2 — Health check responde (**⚠️ hoy devuelve 500 — bug pendiente**)
- [ ] §3 — Nginx OK
- [ ] §4 — TLS/HTTPS válido (si tenés dominio)
- [ ] §5 — Firewall UFW activo con SSH permitido (puerto 22022, NO 22)
- [ ] §6 — fail2ban corriendo
- [ ] §7 — PM2 resurrect funciona (reboot test)
- [ ] §8 — Backup de SQLite ejecutándose
- [ ] §9 — Log rotation configurado
- [ ] §10 — SSH sin password (solo keys)
- [ ] §11 — Deploy flow end-to-end
- [ ] §12 — Pruebas funcionales del agente
- [ ] §13 — Node bindeado solo a 127.0.0.1 (**⚠️ hoy está expuesto en `*:3000`**)

---

## 1. App viva y estable

**Qué estamos chequeando**: que la app no solo arranque, sino que **se mantenga** corriendo sin crashear en loop.

```bash
pm2 status
```

**OK si**:
- `status` = `online`
- `restart` count bajo (0-3 idealmente; más de 10 indica crashes seriales)
- `uptime` creciente entre chequeos

**Si restarts es alto**:
```bash
pm2 logs cafe-x-agent --lines 100 --nostream
```
Buscá stack traces, errores de conexión a APIs, `ECONNREFUSED`, etc.

### Concepto aprendido
`pm2 status` te da el estado actual. `restart` alto = app inestable. PM2 se encarga de levantarla cuando cae, pero si la razón del crash persiste, entrás en un loop infinito "crash → restart → crash". **La solución no es reiniciar más rápido, es arreglar la causa.**

---

## 2. Health check responde

> **⚠️ Estado actual**: el endpoint `/health` devuelve `500 Internal Server Error`. **Bug pendiente de resolver mañana**. Antes de considerar este check pasado, hay que mirar `pm2 logs cafe-x-agent` cuando se hace un curl al endpoint y arreglar la causa del 500.

**Qué estamos chequeando**: que el endpoint `/health` devuelva 200 tanto localmente (desde el VPS) como remotamente (desde internet).

### Desde el VPS (test de que Node responde)

```bash
curl -s http://127.0.0.1:3000/health | jq
```

### Desde tu Mac (test end-to-end, pasando por nginx)

```bash
# Si tenés solo IP
curl -v http://TU-IP/health

# Si tenés dominio + HTTPS
curl -v https://tu-dominio.com/health
```

**OK si**: status `200`, body con `{"status":"ok", ...}`.

**Si local OK pero remoto falla**: problema en nginx o firewall.
**Si local falla**: problema en Node/app.

### Concepto aprendido
**Siempre testeá en capas.** Primero localhost (¿Node anda?), después via nginx (¿el proxy rutea?), después desde afuera (¿el firewall deja pasar?). Si empezás del final hacia el principio, no sabés DÓNDE está roto.

---

## 3. Nginx OK

```bash
# ¿Está corriendo?
sudo systemctl status nginx

# ¿La config tiene errores?
sudo nginx -t

# ¿Logs de acceso llegando?
sudo tail -20 /var/log/nginx/access.log

# ¿Logs de error limpios?
sudo tail -20 /var/log/nginx/error.log
```

**OK si**: status `active (running)`, `nginx -t` dice `syntax is ok` y `test is successful`, access.log muestra tus requests, error.log no tiene errores recientes.

### Concepto aprendido
`nginx -t` valida la config **sin recargarla**. Siempre corré esto ANTES de `systemctl reload nginx` — si hay un error de sintaxis, el reload falla y podés quedarte con nginx caído. El `-t` te avisa antes.

---

## 4. TLS / HTTPS válido

> **Saltear esta sección si NO tenés dominio** — Let's Encrypt no emite certs para IPs.

```bash
# Ver fecha de expiración del cert
sudo certbot certificates

# Validar que HTTPS responde con cert válido
curl -vI https://tu-dominio.com/health 2>&1 | grep -E 'subject|issuer|expire'

# Verificar auto-renewal timer
systemctl list-timers | grep certbot
```

**OK si**:
- Cert expira en >30 días
- `issuer` dice `Let's Encrypt`
- Hay un timer de `certbot.timer` activo (corre 2x/día)

### Test de renovación (dry run)

```bash
sudo certbot renew --dry-run
```

**OK si**: termina con `Congratulations, all simulated renewals succeeded`.

### Concepto aprendido
Los certificados de Let's Encrypt duran **90 días**. Si certbot no renueva automáticamente, tu HTTPS se rompe. El `--dry-run` simula la renovación completa sin cambiar nada — **corré esto una vez para confirmar que la renovación real va a andar cuando toque**.

---

## 5. Firewall UFW activo con SSH permitido

**Contexto**: en el deploy inicial detectamos que UFW quedó inactivo. Este es el check crítico.

### ⚠️ Datos de tu setup real (NO usar los defaults del spec)

- **Puerto SSH**: `22022` (NO el 22 default)
- **Usuario SSH accesible desde afuera**: `root` únicamente (el usuario `deploy` no tiene SSH directo — se accede haciendo `su - deploy` después de loguearse como root)
- **Puerto de Node (bindeo actual)**: `*:3000` → **expuesto a internet**, hay que arreglarlo (ver §13 nuevo)
- **IP del VPS**: `129.121.38.61`

**Implicancia crítica**: **NO uses** `sudo ufw allow OpenSSH`. Ese preset abre el puerto **22**, que NO es donde escucha tu SSH. Si activás el firewall con ese preset, **te quedás afuera del VPS**.

### Activación segura (comandos para TU setup)

**⚠️ ORDEN ESTRICTO — no saltearlo**:

```bash
# 1. Configurar reglas ANTES de activar — usando el puerto REAL de SSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22022/tcp comment 'SSH (puerto custom)'    # CRÍTICO — NO es 22
sudo ufw allow 'Nginx Full'                               # abre 80 y 443

# 2. Verificar reglas pendientes
sudo ufw show added
# Debe listar 22022/tcp y Nginx Full — NO debe aparecer "OpenSSH" ni "22"

# 3. Activar (te pregunta confirmación)
sudo ufw enable

# 4. Ver estado final
sudo ufw status verbose
```

### Test de "no me quedé afuera"

**Desde tu Mac, abrí una SEGUNDA terminal** y hacé:

```bash
ssh -p 22022 root@129.121.38.61
```

Notá dos cosas importantes:
- **`-p 22022`** → puerto custom, sin esto SSH intenta el 22 y falla
- **`root@`** → solo root tiene acceso SSH directo; al usuario `deploy` se accede con `su - deploy` después

**Si funciona** → el firewall está bien, podés cerrar la sesión original tranquilo.
**Si NO funciona** → desde la sesión original (viva) corré `sudo ufw disable` y avisá.

### Concepto aprendido

**Nunca activés un firewall sin abrir primero el puerto REAL de SSH.** El preset `OpenSSH` de UFW asume puerto 22 — si moviste SSH a otro puerto (que es una buena práctica), ese preset te traiciona. **Siempre usá `<puerto>/tcp` explícito cuando el SSH no está en el default.**

Tu sesión actual sigue viva por TCP keep-alive, pero nuevas conexiones se bloquean. Si cerrás la terminal sin validar, te quedás afuera. **La prueba de la segunda terminal es no negociable.**

### Nota sobre el modelo de acceso SSH actual

En tu setup, solo **root** accede por SSH desde afuera. El usuario `deploy` se usa DENTRO del VPS (via `su - deploy`) para correr la app, pero NO se puede `ssh deploy@...` directo.

**Pros**: reduce superficie de ataque SSH (un único usuario a proteger).
**Contras**: estás SSHeando como root, lo cual es peor que SSH a deploy + `sudo` para cosas puntuales. Es un trade-off razonable para un MVP, pero considerá migrar a:

1. SSH directo a `deploy` con SSH key
2. `PermitRootLogin no` en sshd_config
3. `sudo` para comandos privilegiados

Esto se documenta como mejora futura en §10.

---

## 6. fail2ban corriendo

```bash
# ¿Activo?
sudo systemctl status fail2ban

# ¿Qué jails están configurados?
sudo fail2ban-client status

# ¿Hay IPs baneadas en el jail de SSH?
sudo fail2ban-client status sshd
```

**OK si**: status `active (running)`, `sshd` aparece en la lista de jails.

Si ves IPs baneadas en `sshd` — **no te asustes**, son bots escaneando internet. Es señal de que fail2ban está haciendo su trabajo.

### Concepto aprendido
- **UFW** bloquea puertos → defensa estática
- **fail2ban** bloquea IPs por comportamiento → defensa dinámica

**Los dos juntos = defensa en capas (defense in depth)**. Si un bot logra pasar UFW (porque SSH está abierto), fail2ban lo banea después de 5 intentos fallidos.

---

## 7. PM2 resurrect funciona (reboot test)

**El test más importante y el que más gente saltea.** Si el VPS se reinicia por un corte de luz/mantenimiento de HostGator, ¿tu app arranca sola?

```bash
# Ver la app corriendo AHORA
pm2 status

# Reiniciar el VPS
sudo reboot
```

Esperá 1-2 min, volvé a conectarte por SSH, y corré:

```bash
pm2 status
```

**OK si**: la app sigue `online` con uptime reciente (segundos/minutos).
**NO OK si**: `pm2 status` dice "[PM2] Spawning PM2 daemon..." y lista vacía → el unit de systemd no está bien configurado.

### Fix si falla

```bash
# Como deploy, dentro del directorio del proyecto
cd /var/www/cafe-x-agent
pm2 start dist/main.js --name cafe-x-agent --time
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
# Ejecutar el `sudo ...` que te imprime
```

### Concepto aprendido
**Un deploy sin reboot test es un deploy a medias.** En algún momento el VPS se reinicia (por vos, por el proveedor, por un kernel update automático). Si la app no arranca sola, el servicio está caído hasta que alguien se entere.

---

## 8. Backup de SQLite ejecutándose

Si configuraste el cron del paso 12 del spec:

```bash
# ¿El cron está registrado?
crontab -l

# ¿Hay backups en el directorio?
ls -la ~/backups/
```

**OK si**: vas a ver `cafe-x-agent-YYYY-MM-DD.db` del día anterior (si el cron corrió a las 3 AM).

### Test manual (sin esperar al cron)

```bash
# Ejecutar el mismo comando que corre el cron
sqlite3 /var/www/cafe-x-agent/data/cafe-x-agent.db ".backup '/home/deploy/backups/manual-test.db'"

# Verificar que se creó
ls -la ~/backups/manual-test.db

# Verificar que es una DB válida
sqlite3 ~/backups/manual-test.db ".tables"

# Cleanup
rm ~/backups/manual-test.db
```

### Concepto aprendido
**Un backup que nunca testeaste NO es un backup, es una ilusión.** Muchos sistemas tienen "backups" que, cuando los intentás restaurar, están corruptos o vacíos. El test manual te confirma que el comando funciona y que el archivo resultante es una DB válida.

---

## 9. Log rotation configurado

```bash
# ¿Está instalado el modulo?
pm2 list | grep logrotate    # debe aparecer "pm2-logrotate" como proceso

# Ver config actual
pm2 conf pm2-logrotate
```

**OK si**:
- `max_size` = `10M`
- `retain` = `14`
- `compress` = `true`

### Concepto aprendido
Sin rotación, `~/.pm2/logs/cafe-x-agent-out.log` crece hasta llenar el disco. Cuando eso pasa, **toda la app deja de funcionar** (no puede escribir nada, incluida la DB). El log rotation no es un "nice to have", es protección básica.

---

## 10. SSH sin password (solo keys)

**Verificá que nadie pueda entrar por password al VPS** — solo por SSH key.

### Estado actual de tu setup

- Puerto SSH: `22022` ✅ (ya está en puerto custom, dodge 99% del escaneo automático)
- Autenticación: **password** ❌ (hay que migrar a keys)
- Usuario con SSH externo: **root** (deploy no tiene SSH directo)

### Verificar config actual

```bash
# Como root
grep -E 'PasswordAuthentication|PubkeyAuthentication|PermitRootLogin|AllowUsers|Port' /etc/ssh/sshd_config
```

**Objetivo final**:
```
Port 22022
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin prohibit-password
```

### Plan de migración a SSH keys (orden importa)

**⚠️ NO desactivés passwords hasta tener la key funcionando.** Si la key falla y passwords están off, te quedás afuera.

#### Paso 1 — Generar key en tu Mac (si no tenés)

```bash
# En tu Mac local
ssh-keygen -t ed25519 -C "mi-mac@cafe-x-agent-vps" -f ~/.ssh/id_ed25519_cafeagent
```

#### Paso 2 — Copiar la key pública al VPS

```bash
# En tu Mac — ssh-copy-id respeta el puerto custom con -p
ssh-copy-id -p 22022 -i ~/.ssh/id_ed25519_cafeagent.pub root@129.121.38.61
```

Te pide password de root **una última vez** — después no te lo pide más.

#### Paso 3 — Configurar tu Mac para usar esta key con este host

Agregá a tu `~/.ssh/config` local:

```
Host cafe-x-agent-vps
    HostName 129.121.38.61
    User root
    Port 22022
    IdentityFile ~/.ssh/id_ed25519_cafeagent
    IdentitiesOnly yes
```

Con eso podés hacer `ssh cafe-x-agent-vps` directo sin flags.

#### Paso 4 — Probar la key ANTES de deshabilitar passwords

```bash
# Desde tu Mac — segunda terminal, NO cierres la original
ssh cafe-x-agent-vps
```

Si entrás sin pedirte password → la key funciona. Proceder al paso 5.
Si te pide password → NO sigas. Revisá qué falla (permisos de `~/.ssh`, key mal copiada, etc.).

#### Paso 5 — Deshabilitar passwords

```bash
# En el VPS como root
nano /etc/ssh/sshd_config
# Cambiar:
#   PasswordAuthentication yes  →  PasswordAuthentication no

# Validar sintaxis
sshd -t

# Aplicar (reload NO desconecta tu sesión actual)
systemctl reload ssh
```

#### Paso 6 — Confirmación final

Abrí una **tercera** terminal en tu Mac:

```bash
ssh cafe-x-agent-vps
```

**Debe entrar sin password.** Si ahora te pide password o falla, tenés la primera sesión viva para revertir con `sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config && systemctl reload ssh`.

### Mejora futura recomendada — eliminar SSH root

Una vez cómodo con keys, considerá:

1. **Crear SSH directo al usuario `deploy`** (en vez de root):
   ```bash
   # En el VPS como root
   mkdir -p /home/deploy/.ssh
   cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   chmod 700 /home/deploy/.ssh
   chmod 600 /home/deploy/.ssh/authorized_keys
   ```

2. **Deshabilitar SSH root completamente**:
   ```
   PermitRootLogin no
   ```

3. Usás `sudo` cuando necesites privilegios.

**Por qué mejor así**: si alguien logra comprometer tu SSH key, solo gana acceso a `deploy` (no-privilegiado). Tiene que escalar a root — capa adicional de defensa.

### Concepto aprendido

Los passwords son vulnerables a fuerza bruta. Las SSH keys son matemáticamente inviables de romper. **En un VPS en internet, `PasswordAuthentication no` es estándar.**

Tu SSH ya está en puerto `22022` — eso te ahorra el 99% del tráfico malicioso automatizado (bots solo escanean 22). **Con keys + puerto custom, tu SSH está tan protegido como razonablemente podés.**

---

## 11. Deploy flow end-to-end

**Simulá un deploy real para confirmar que todo el pipeline funciona**.

### Desde tu Mac

```bash
# Hacé un cambio trivial (ej: editar un comentario en algún archivo)
git commit -am "chore: test deploy flow"
git push origin release/v1.0.0-beta
```

### En el VPS como deploy

```bash
cd /var/www/cafe-x-agent
git pull
fnm use
npm ci
npm run build
pm2 reload cafe-x-agent
```

### Validar

```bash
# Ver que no haya downtime en el health check mientras hacés reload
# Desde tu Mac, en loop mientras corrés el reload arriba (via nginx, puerto 80):
while true; do curl -s -o /dev/null -w "%{http_code}\n" http://129.121.38.61/health; sleep 1; done
```

**OK si**: todos los requests durante el reload devuelven `200`. Si ves algún `502` o `503`, el reload tuvo downtime.

### Concepto aprendido
`pm2 reload` hace **graceful restart**: levanta la nueva instancia antes de matar la vieja. En teoría, cero downtime. En la práctica, depende de que tu app respete `SIGTERM` y cierre conexiones abiertas antes de salir. Si ves 502s, la app no está manejando bien el shutdown.

---

## 12. Pruebas funcionales del agente

**El deploy está "arriba" pero ¿hace lo que tiene que hacer?**

### Telegram bot

- [ ] `/start` → responde
- [ ] `/status` → muestra estado del sistema
- [ ] `/tema <tema>` → aceptado
- [ ] `/generar` → genera un tweet propuesto
- [ ] Botones inline de aprobación/rechazo funcionan

### X (Twitter) publish

- [ ] Aprobar un tweet → se publica en X
- [ ] Verificar que aparece en tu timeline real

### RSS capture (crons)

- [ ] Mirar logs a la hora del cron de captura RSS (2x/día)
- [ ] Confirmar que `ContentSnapshot` tiene entries nuevas

```bash
# Inspeccionar la DB
sqlite3 /var/www/cafe-x-agent/data/cafe-x-agent.db \
  "SELECT COUNT(*), MAX(captured_at) FROM content_snapshot;"
```

### Concepto aprendido
**Health check verde ≠ app funcional.** `/health` solo te dice que el HTTP server está vivo. La lógica de negocio (Telegram, X, Claude, RSS) puede estar rota y `/health` seguir verde. **Los smoke tests funcionales son imprescindibles** — no podés concluir "deploy OK" sin probar los caminos reales del usuario.

---

## 13. Node bindeado solo a localhost (127.0.0.1)

**⚠️ Hallazgo del deploy inicial**: tu Node está escuchando en `*:3000` (todas las interfaces), lo que significa que **cualquiera en internet puede hitear `http://129.121.38.61:3000/...` directo**, saltándose nginx.

### Verificar bind actual

```bash
sudo ss -tulpn | grep 3000
```

**Estado actual (malo)**:
```
tcp LISTEN 0 511 *:3000 *:* users:(("node /var/www/c",pid=...))
```

**Estado objetivo (bueno)**:
```
tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node /var/www/c",pid=...))
```

### Fix — en el código

Editá `src/main.ts` (o donde esté tu bootstrap de NestJS):

```typescript
// Antes
await app.listen(3000);

// Después
await app.listen(3000, '127.0.0.1');
```

Mejor aún, leyéndolo del `.env`:

```typescript
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen(port, host);
```

Y agregás al `.env` del VPS:

```
HOST=127.0.0.1
PORT=3000
```

### Aplicar y validar

```bash
# En el VPS como deploy
cd /var/www/cafe-x-agent
git pull
npm ci
npm run build
pm2 reload cafe-x-agent

# Verificar el nuevo bind
sudo ss -tulpn | grep 3000
# Esperado: 127.0.0.1:3000
```

### Tests de confirmación

```bash
# Desde el VPS — debe funcionar (nginx y Node conviven en localhost)
curl http://127.0.0.1:3000/health

# Desde tu Mac — debe FALLAR (timeout o connection refused)
curl -m 5 http://129.121.38.61:3000/health

# Desde tu Mac via nginx — debe funcionar
curl http://129.121.38.61/health
```

**OK si**:
- VPS localhost:3000 → responde
- Mac:3000 → falla (connection refused o timeout)
- Mac puerto 80 via nginx → responde

### Concepto aprendido

**Por default, muchos frameworks bindean en `0.0.0.0`** (todas las interfaces) porque "funciona en desarrollo". En producción detrás de un reverse proxy (nginx), **esto es un error de seguridad**.

Cuando ponés un reverse proxy:
- **Nginx** debe ser el **único** servicio expuesto al mundo (puertos 80/443)
- La **app real** vive detrás, en localhost (127.0.0.1)
- Cualquier otro servicio que agregues (Redis, Postgres, etc.) también en localhost

Esto se llama **localhost binding** y es una de las primeras reglas de hardening de un servidor.

**Bonus**: con el firewall activo (§5), aunque Node bindee mal, UFW igual bloquea el puerto 3000 desde afuera. Eso es **defense in depth** — dos capas que se cubren mutuamente. Si una falla, la otra te salva.

---

## Cheat sheet — comandos de supervivencia

Para tener a mano siempre:

```bash
# Ver estado general
pm2 status && sudo systemctl status nginx fail2ban

# Ver logs en vivo
pm2 logs cafe-x-agent

# Ver qué IPs están atacando
sudo fail2ban-client status sshd
sudo tail -f /var/log/auth.log

# Liberar espacio en disco si algo se llenó
df -h                                    # ver espacio
du -sh /var/log/* | sort -h              # quién come disco
sudo journalctl --vacuum-time=7d         # truncar journald

# Reiniciar servicios
sudo systemctl reload nginx
pm2 reload cafe-x-agent

# Ver puertos abiertos (validar firewall)
sudo ss -tulpn
sudo ufw status verbose
```

---

## Si algo falla — troubleshooting checklist

1. **App no responde** → `pm2 logs cafe-x-agent --lines 100`
2. **Nginx 502** → la app está caída o no escucha en el puerto esperado
3. **Nginx 504** → la app es muy lenta (timeout del proxy)
4. **SSL expirado** → `sudo certbot renew --force-renewal`
5. **No puedo entrar por SSH** → consola de emergencia de HostGator → `sudo ufw disable`
6. **Disco lleno** → logs sin rotar, backups acumulados, o algo explotó

---

## Próximos pasos (cuando todo esto pase)

Una vez que los 12 checks pasen, considerá:

- **Monitoring externo**: UptimeRobot (gratis) te avisa por email si el health check cae.
- **Alertas por Telegram**: mandarte vos mismo un mensaje si PM2 detecta un crash.
- **Dominio real**: si todavía no tenés, conseguí uno (USD 10/año) o DuckDNS (gratis) — habilita HTTPS y webhooks.
- **CI/CD**: que el deploy se dispare automático desde un push a `main`, en vez de correrlo a mano.
- **Métricas**: PM2+ Plus (paid) o Prometheus + Grafana (free, más setup) para ver tendencias de CPU/RAM/requests.

Nada de esto es obligatorio para un MVP, pero son los siguientes peldaños naturales.

---

**Recordatorio**: este documento es un **runbook**, no un one-shot. Volvé cada vez que algo falle, o cuando hagas cambios grandes de infra. Los conceptos aprendidos acá valen para CUALQUIER app que despliegues en el futuro — no son exclusivos de cafe-x-agent.
