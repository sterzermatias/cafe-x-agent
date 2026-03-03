# cafe-x-agent

Agente AI para X (Twitter) que genera y publica tweets sobre cualquier tema relevante, aprendiendo del perfil [@--user--](https://x.com/--user--), sus likes, retweets, tweets anteriores y el feed "For You".

Interactúa vía bot de Telegram para aprobaciones y notificaciones. Corre de forma permanente en una **Raspberry Pi Zero 2W**.

## Stack

- **NestJS 11** — Framework modular
- **TypeORM + SQLite** (`better-sqlite3`) — Persistencia liviana, ideal para la Pi
- **grammy** — Bot de Telegram
- **twitter-api-v2** — Cliente Twitter API v2
- **@anthropic-ai/sdk** — Claude Haiku para análisis y generación
- **@nestjs/schedule** — Cron jobs

## Arquitectura

```
src/
├── config/           # Validación de env vars
├── telegram/         # Bot, comandos, inline keyboards, whitelist
├── twitter/          # Fetch perfil/likes/tweets/feed, postear tweets
├── anthropic/        # Wrapper Claude Haiku API
├── learning/         # Análisis de perfil + feed → ProfileSummary + FeedSnapshot
├── tweet-generator/  # Generación de tweets, flujo aprobación/rechazo
├── scheduler/        # Crons: captura de feed 2x/día, propuesta diaria
├── health/           # GET /health para monitoreo
└── entities/         # ProfileSummary, GeneratedTweet, FeedSnapshot
```

## Comandos de Telegram

| Comando | Acción |
|---------|--------|
| `/start` | Saludo inicial |
| `/aprender` | Analiza perfil, likes, tweets y feed. Guarda resumen en DB |
| `/generar` | Genera un tweet y lo propone con botones Aprobar / Rechazar / Regenerar |
| `/status` | Último tweet publicado, stats del día, último feed capturado |

## Setup

### Requisitos

- Node.js 18+
- Credenciales de Twitter API v2 (OAuth 1.0a user context)
- Token de bot de Telegram (vía [@BotFather](https://t.me/BotFather))
- API key de Anthropic

### Instalación

```bash
npm install
cp .env.example .env
# Completar las variables en .env
```

### Variables de entorno

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_ID=
TWITTER_APP_KEY=
TWITTER_APP_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
TWITTER_USERNAME=sterzermatiass
ANTHROPIC_API_KEY=
CRON_TIMEZONE=America/Argentina/Buenos_Aires
DB_PATH=db.sqlite          # opcional
```

### Desarrollo

```bash
npm run start:dev      # Watch mode
npm run start:debug    # Con debugger
npm run lint           # ESLint con auto-fix
npm run format         # Prettier
```

### Tests

```bash
npm test               # Unit tests
npm run test:watch     # Watch mode
npm run test:cov       # Con coverage
npm run test:e2e       # E2E tests
```

### Build y producción

```bash
npm run build
npm run start:prod     # node dist/main
```

## Deploy en Raspberry Pi Zero 2W

El agente está diseñado para correr 24/7 en una Pi Zero 2W (512MB RAM, microSD).

```bash
# En la Pi
git pull
npm install --production
npm run build

# Con PM2 (recomendado)
pm2 start dist/main.js --name cafe-x-agent --max-memory-restart 400M
pm2 save && pm2 startup
```

SQLite usa WAL mode para minimizar escrituras en la microSD. PM2 reinicia el proceso automáticamente tras crashes o reinicios del sistema.

Monitoreo: `GET /health` retorna uptime, memoria, CPU y timestamps del último feed y tweet.
