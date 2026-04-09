# cafe-x-agent — Estado de Avance

**Fecha de actualización**: 2026-03-25

---

## Resumen General

Agente de IA para X (Twitter) que genera y publica tweets aprendiendo del estilo del usuario. Usa NestJS 11, SQLite (TypeORM), Claude API (Haiku + Sonnet), RSS feeds, y Telegram como interfaz de control.

Target de deploy: Raspberry Pi Zero 2W.

---

## Pasos del Plan de Implementación

| Paso | Descripcion | Estado |
|------|-------------|--------|
| 1 | Config, dependencias, DB setup | ✅ Completo |
| 2 | Entidades (ProfileSummary, GeneratedTweet, ContentSnapshot) | ✅ Completo |
| 3 | TwitterModule (publish-only) | ✅ Completo |
| 4 | RSSModule | ✅ Completo |
| 5 | AnthropicModule (Haiku + Sonnet) | ✅ Completo |
| 6 | LearningModule | ✅ Completo |
| 7 | TweetGeneratorModule (con retry e idempotencia) | ✅ Completo |
| 8 | TelegramModule (bot grammy) | ✅ Completo |
| 9 | SchedulerModule (crons) | ✅ Completo |
| 10 | HealthModule (GET /health) | ✅ Completo |
| 11 | Testing (unit) | ✅ Completo (42 tests) |
| 12 | Deploy en Raspberry Pi | Fuera de scope |

---

## Detalle de lo implementado

### Sesion 2026-03-21 — Core Pipeline

#### Fase 1: Entity Schema
- `json-column.transformer.ts` — transformer reutilizable para columnas JSON en SQLite
- `content-snapshot.entity.ts` — reemplaza FeedSnapshot, con raw_content y source_feeds como JSON
- `profile-summary.entity.ts` — interests ahora es string[] con JSON transformer, OneToMany a GeneratedTweet
- `generated-tweet.entity.ts` — 5 campos nuevos: rejection_reason, twitter_id, generation_context (JSON), max_publish_retries (default 5), publish_retry_count (default 0). TweetStatus incluye 'failed'. FK a ProfileSummary y ContentSnapshot

#### Fase 2: LearningModule
- `analyzeFromExport()` — lee tweet export JSON, filtra RTs, analiza con Haiku, upsert ProfileSummary
- `captureContent()` — captura RSS, resume con Haiku, persiste ContentSnapshot. Fallback a ultimo snapshot si RSS falla
- `updateProfileFromFeedback()` — refina perfil con tweets aprobados/rechazados

#### Fase 3: TweetGeneratorModule
- `generate()` — carga perfil + snapshot + feedback loop (5 approved + 5 rejected como few-shot), genera con Sonnet, valida largo (<=280) y contenido seguro (max 3 intentos)
- `approve()` — idempotente, 2 retries inmediatos con backoff, deja como 'approved' si falla (cron lo reintenta)
- `reject(id, reason)` — marca como rechazado con razon
- `retryApproved()` — batch retry de tweets approved sin twitter_id, respeta max_publish_retries, marca 'failed' cuando se agotan
- `getStats()` — estadisticas agregadas

#### Fase 4: TelegramModule
- Bot grammy con long polling y whitelist por user ID
- Comandos: /start, /aprender, /generar, /tema, /status
- Inline keyboards: aprobar, rechazar (con razones preset + texto libre), regenerar
- `sendNotification()` — API publica para otros modulos

#### Fase 5: Integration
- Todos los modulos wired en AppModule
- Build + lint pasan limpio

### Sesion 2026-03-25 — Scheduler, Health, Testing

#### SchedulerModule (4 cron jobs)
- **RSS Capture** (`0 12,21 * * *`) — captura RSS 2x/dia (9AM y 6PM ARG), notifica errores por Telegram
- **Daily Tweet Proposal** (`0 13 * * *`) — genera tweet a las 10AM ARG, envía por Telegram para aprobación
- **Retry Approved** (`*/15 * * * *`) — reintenta publicar tweets aprobados cada 15min, notifica exitos y max retries
- **Weekly Profile Refinement** (`0 14 * * 0`) — domingos 11AM ARG, refina perfil con feedback de la semana
- Timezone hardcodeada en decoradores con warning si difiere de CRON_TIMEZONE env var
- `safeNotify()` wrapper para que fallos de Telegram no rompan los crons

#### HealthModule
- `GET /health` — uptime, memoria (rss/heap en MB), CPU load, ultimo ContentSnapshot, ultimo tweet publicado
- Stats: total tweets, approval rate, tweets generados hoy
- Todas las queries en paralelo con Promise.all

#### Refactor de env vars de Twitter
- Renombradas para matchear el portal de X Developer:
  - `TWITTER_APP_KEY` → `TWITTER_CONSUMER_KEY`
  - `TWITTER_APP_SECRET` → `TWITTER_CONSUMER_KEY_SECRET`
  - `TWITTER_ACCESS_SECRET` → `TWITTER_ACCESS_TOKEN_SECRET`
- Agregado `TWITTER_BEARER_TOKEN` como opcional (no se usa, publish-only)

#### Testing — 42 tests, 7 suites
| Suite | Tests | Cobertura |
|-------|-------|-----------|
| twitter.service.spec.ts | 5 | Post, delete, lookup, error handling |
| rss.service.spec.ts | 6 | Capture, filtrado 24h, fallos parciales |
| anthropic.service.spec.ts | 8 | 4 metodos + retry 529 + JSON parsing |
| learning.service.spec.ts | 9 | Export, RSS capture, feedback, fallbacks |
| tweet-generator.service.spec.ts | 10 | Generate, approve, reject, stats, retries |
| health.controller.spec.ts | 3 | Endpoint, nulls, approval rate |
| app.controller.spec.ts | 1 | Scaffold (pre-existente) |

---

## Pendiente

### Prioridad alta — Prueba end-to-end manual
- [ ] Completar `.env` con ANTHROPIC_API_KEY
- [ ] Configurar RSS_FEED_URLS con feeds relevantes
- [ ] Preparar tweet export de prueba en `./data/tweet-export.json`
- [ ] Levantar el bot (`npm run start:dev`) y probar flujo: /aprender → /generar → aprobar → verificar en X
- [ ] Verificar que el rechazo con razones funciona correctamente
- [ ] Verificar que GET /health responde correctamente

### Prioridad baja — Mejoras futuras
- [ ] E2E tests con mocks de APIs externas
- [ ] Deploy en Raspberry Pi (PM2/systemd, persistencia, monitoreo)
- [ ] Limpieza de datos viejos (ContentSnapshots >30d, rechazados >90d)
- [ ] Comando /link para analizar URLs y generar tweets basados en contenido

---

## Arquitectura SDD

Se uso Spec-Driven Development para planificar el core pipeline. Artefactos en engram:

| Artefacto | Topic Key | Estado |
|-----------|-----------|--------|
| Exploracion | sdd/core-generation-pipeline/explore | ✅ |
| Propuesta | sdd/core-generation-pipeline/proposal | ✅ |
| Especificacion | sdd/core-generation-pipeline/spec | ✅ |
| Diseno tecnico | sdd/core-generation-pipeline/design | ✅ |
| Task breakdown | sdd/core-generation-pipeline/tasks | ✅ |
| Implementacion | sdd/core-generation-pipeline/apply-progress | ✅ |
| Verificacion | sdd/core-generation-pipeline/verify-report | ❌ Pendiente |
