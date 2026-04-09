# PRD — cafe-x-agent

## 1. Producto

**cafe-x-agent** es un agente autónomo que genera y publica tweets en X (Twitter) aprendiendo del estilo de escritura del usuario. Opera como un ghostwriter personal controlado via Telegram.

## 2. Problema

Mantener una presencia activa en X requiere tiempo y consistencia. El usuario quiere publicar contenido relevante y auténtico sin dedicar tiempo diario a escribir tweets manualmente, pero sin perder su voz personal ni publicar contenido genérico.

## 3. Solución

Un agente que:
1. **Aprende** el estilo del usuario a partir de un export de tweets históricos
2. **Se alimenta** de contenido externo (RSS feeds) y temas manuales para mantenerse relevante
3. **Genera** tweets que imitan la voz del usuario usando Claude (Sonnet)
4. **Propone** tweets diarios via Telegram para aprobación humana
5. **Evoluciona** su comprensión del estilo mediante un feedback loop (tweets aprobados/rechazados)

## 4. Usuarios

Un solo usuario (el dueño de la cuenta de X). El sistema es single-tenant con whitelist por Telegram user ID.

## 5. Flujos principales

### 5.1 Onboarding
1. El usuario exporta sus tweets desde X (archivo JSON)
2. Envía `/aprender` en Telegram
3. El agente analiza el export con Claude Haiku y construye un perfil de estilo + intereses
4. El perfil queda guardado en la base de datos

### 5.2 Generación diaria (automática)
1. Cron captura contenido de RSS feeds 2 veces al día (9AM, 6PM ARG)
2. Claude Haiku resume los temas trending
3. Cron diario (10AM ARG) genera un tweet usando Claude Sonnet con:
   - Perfil de estilo del usuario
   - Contenido trending de RSS
   - Últimos 5 tweets aprobados (ejemplos positivos)
   - Últimos 5 tweets rechazados con razón (ejemplos negativos)
4. Valida que el tweet sea seguro (segunda pasada con Haiku)
5. Envía la propuesta por Telegram con botones: Aprobar / Rechazar / Regenerar

### 5.3 Generación manual
1. El usuario envía `/generar` (tema libre) o `/tema <texto>` (tema específico)
2. El agente genera, valida y propone igual que en el flujo automático

### 5.4 Aprobación / Rechazo
- **Aprobar**: publica el tweet en X inmediatamente. Si falla, queda en cola para reintento automático (cada 15min, máximo 5 intentos)
- **Rechazar**: el usuario elige una razón predefinida (Muy formal, Off-topic, No suena a mí, Aburrido) o escribe una personalizada. El tweet rechazado con su razón alimenta el feedback loop para mejorar futuras generaciones

### 5.5 Refinamiento semanal
- Cron dominical analiza los tweets aprobados y rechazados de la semana
- Claude refina el perfil de estilo del usuario automáticamente

## 6. Stack técnico

| Componente | Tecnología |
|------------|------------|
| Runtime | Node.js (NestJS 11) |
| Base de datos | SQLite via TypeORM (better-sqlite3, WAL mode) |
| IA — Generación | Claude Sonnet (creatividad, estilo) |
| IA — Análisis/Validación | Claude Haiku (rápido, económico) |
| Twitter API | twitter-api-v2 (Free tier, publish-only) |
| Contenido externo | RSS feeds via rss-parser |
| Interfaz de usuario | Bot de Telegram (grammy) |
| Scheduling | @nestjs/schedule (cron jobs) |
| Deploy target | Raspberry Pi Zero 2W |

## 7. Módulos

```
AppModule
├── ConfigModule          — Variables de entorno con validación
├── TypeOrmModule          — SQLite con 3 entidades
├── ScheduleModule         — Infraestructura de crons
├── TwitterModule          — Publish-only (postTweet, deleteTweet, lookupUser)
├── RSSModule              — Captura de feeds RSS en paralelo
├── AnthropicModule        — 4 métodos: analyzeProfile, summarizeTopics, generateTweet, validateContent
├── LearningModule         — Análisis de export, captura de contenido, refinamiento de perfil
├── TweetGeneratorModule   — Generación, aprobación, rechazo, retry, estadísticas
├── TelegramModule         — Bot con comandos, inline keyboards, notificaciones
├── SchedulerModule        — 4 crons: RSS 2x/día, tweet diario, retry 15min, refinamiento semanal
└── HealthModule           — GET /health con métricas del sistema
```

## 8. Entidades

### ProfileSummary
- `style` (text) — Descripción del estilo de escritura del usuario
- `interests` (string[] como JSON) — Lista de intereses/temas
- `last_updated` (ISO timestamp)

### GeneratedTweet
- `content` (text) — El tweet generado
- `status` (pending | approved | published | rejected | failed)
- `rejection_reason` (text, nullable) — Razón del rechazo
- `twitter_id` (text, nullable) — ID del tweet publicado en X
- `generation_context` (JSON) — Metadatos: modelo usado, fuentes RSS, IDs de feedback
- `publish_retry_count` / `max_publish_retries` — Control de reintentos
- FK → ProfileSummary, FK → ContentSnapshot

### ContentSnapshot
- `topics_summary` (text) — Resumen de temas trending generado por Claude
- `raw_content` (JSON) — Entradas RSS crudas
- `source_feeds` (JSON) — URLs de los feeds procesados
- `captured_at` (ISO timestamp)

## 9. Seguridad

- **Contenido**: doble validación — restricciones en el prompt de generación + segunda pasada con validateContent()
- **Acceso**: whitelist por Telegram user ID (single user)
- **Credenciales**: todas en `.env`, validadas al arranque, nunca en código
- **Rate limiting**: Bottleneck en Twitter API (1 req/2s, retry en 429)
- **Retry**: exponential backoff en Anthropic API (529), máximo 3 intentos

## 10. Restricciones de contenido

Todo tweet generado DEBE cumplir:
- No contenido sexual, explícito o sugestivo
- No lenguaje ofensivo, violento o de odio
- No discriminación de ningún tipo
- No ataques personales ni acoso
- No desinformación ni claims no verificados
- Tono respetuoso y profesional

## 11. Limitaciones conocidas

- **X API Free tier**: solo publicar/borrar tweets y lookup de usuario. No se puede leer timeline, likes, búsqueda ni menciones
- **Single tenant**: diseñado para un solo usuario
- **Sin media**: solo genera tweets de texto, no imágenes ni hilos
- **Telegram-only**: no hay interfaz web ni CLI de administración
- **SQLite**: no escala a múltiples instancias concurrentes

## 12. Métricas de éxito

- Approval rate > 70% (el usuario aprueba al menos 7 de cada 10 tweets propuestos)
- El agente corre 24/7 sin intervención manual
- El estilo de los tweets generados es indistinguible del estilo real del usuario
- Tiempo promedio desde propuesta hasta publicación < 5 minutos (asumiendo aprobación inmediata)

## 13. Roadmap futuro

- [ ] Comando `/link <url>` — analizar contenido de un link y generar tweet basado en él
- [ ] Soporte para hilos (threads) de múltiples tweets
- [ ] Generación de imágenes con descripción para tweets con media
- [ ] Dashboard web con estadísticas y gestión de perfil
- [ ] Limpieza automática de datos viejos (snapshots >30d, rechazados >90d)
- [ ] Deploy automatizado en Raspberry Pi con PM2/systemd
