# SQLite Analysis — cafe-x-agent

**Fecha:** 2026-04-08
**Status:** Pendiente de implementar

## Contexto

Evaluacion de si SQLite es suficiente para cafe-x-agent en produccion (VPS HostGator).
Conclusion: **SQLite es la eleccion correcta** para este caso de uso.

## Volumen estimado de datos

| Metrica | Ano 1 | Ano 5 |
|---------|-------|-------|
| ContentSnapshots | ~730 | ~3,650 |
| GeneratedTweets | ~2,000 | ~10,000 |
| Tamano total DB | ~20-60 MB | ~100-300 MB |

Write rate: ~7 rows/dia. Sin concurrencia real de escritura.

## Mejoras a implementar

### 1. [HIGH] Indices faltantes en GeneratedTweet

El retry job corre cada 15 min y hace queries sin indice sobre `status` y `created_at`.

```sql
CREATE INDEX idx_generated_tweet_status ON generated_tweet(status);
CREATE INDEX idx_generated_tweet_created_at ON generated_tweet(created_at);
CREATE INDEX idx_generated_tweet_profile_summary_id ON generated_tweet(profile_summary_id);
```

### 2. [HIGH] Full table scan en getStats()

`tweet-generator.service.ts` — `getStats()` hace `this.tweetRepo.find()` sin WHERE.
Escanea toda la tabla cada vez que se llama `/status`.

**Fix:** Reemplazar con queries agregados usando `count()` con filtros por status, o paginar.

### 3. [MEDIUM] Politica de retencion

No hay cleanup de datos viejos. ContentSnapshots y GeneratedTweets se acumulan indefinidamente.

**Propuesta:**
- ContentSnapshots: retener ultimos 90 dias, archivar o eliminar anteriores
- GeneratedTweets: retener indefinido (son pocos y tienen valor para el feedback loop)
- Implementar como cron job en SchedulerModule

### 4. [MEDIUM] ContentSnapshot raw_content demasiado grande

`raw_content` guarda el array completo de entries RSS como JSON en una columna TEXT (~20-70KB por snapshot).

**Propuesta:** Separar entries en tabla propia con FK a ContentSnapshot para queries mas eficientes.

### 5. [LOW] Foreign keys sin constraints

`GeneratedTweet.profile_summary_id` y `content_snapshot_id` son columnas `number` sin `@JoinColumn` con `onDelete`.
Si se borra un ProfileSummary, los tweets quedan huerfanos.

**Fix:** Agregar relaciones TypeORM con `onDelete: 'SET NULL'` o `'CASCADE'`.

## Cuando migrar a Postgres

Ninguno de estos escenarios aplica hoy, pero documentamos para referencia:

- Multiples instancias del agente escribiendo a la misma DB
- Full-text search pesado sobre contenido
- Queries analiticos complejos con JOINs pesados
- Mas de ~100 writes concurrentes/segundo
