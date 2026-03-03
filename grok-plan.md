# Plan de Trabajo Detallado para el Proyecto "cafe-x-agent"

**repositorio de ejemplo: https://github.com/acrosa/alfajor-raspberry
**Autor:** Grok (basado en conversaciones con Matías @sterzermatiass)  
**Fecha:** Marzo 2026  
**Objetivo General:** Desarrollar un agente AI simple para X (Twitter) que genere y publique tweets sobre tecnología, aprendiendo de tu perfil (@sterzermatiass), likes y replies. El agente interactúa vía bot de Telegram para aprobaciones y notificaciones. Se ejecuta en Raspberry Pi Zero 2W, desarrollado en NestJS (Node.js). Sin auto-mejora (fuera de scope).  

**Duración Estimada:** 3-4 semanas (asumiendo 10-20 horas/semana).  
**Repositorio:** https://github.com/msterzer/cafe-x-agent (inicial o vacío; construiremos sobre él).  
**Requisitos Previos:**  
- Claves API: Twitter (desarrollador), Telegram (BotFather), Anthropic (Claude Haiku).  
- Hardware: Raspberry Pi Zero 2W con Raspbian, Node.js v20 instalado.  
- Herramientas: Git, VS Code, Postman (para APIs), SSH para Pi.  

**Arquitectura General:**  
- Módulos NestJS: Telegram, Twitter, Learning (análisis estático), Tweet Generator, Scheduler.  
- Base de Datos: SQLite (ligera para Pi).  
- Flujo Típico: Comando Telegram → Análisis/Generación → Aprobación → Publicación → Notificación.  

## Fase 1: Preparación (1-2 días)
**Objetivo:** Inicializar el proyecto y repo.  

1. Clonar o inicializar el repositorio:  
   - `git clone https://github.com/sterzermatias/cafe-x-agent` (o `git init` si vacío).  
   - Agregar/commit archivos iniciales si es necesario.  

2. Crear proyecto NestJS:  
   - `cd cafe-x-agent`  
   - `nest new . --package-manager npm` (sobrescribe si aplica).  
   - Configurar tsconfig.json para strict mode.  

3. Definir estructura de módulos:  
   - Crear carpetas/módulos: `nest generate module telegram`, `nest generate module twitter`, etc.  
   - Instalar dependencias:  
     ```
     npm install @nestjs/common @nestjs/core @nestjs/schedule grammy @twitter-api-v2/client @anthropic-ai/sdk sqlite3 dotenv bottleneck @nestjs/typeorm typeorm
     npm install --save-dev @types/node ts-node jest @nestjs/testing
     ```  

4. Configurar .env:  
   - Incluir variables como `TWITTER_BEARER_TOKEN`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`.  
   - Agregar .gitignore para ignorar .env y node_modules.  

5. Actualizar README.md:  
   - Secciones: Instalación, Configuración, Comandos, Deploy en Pi, Troubleshooting.  
   - Descripción: "Agente AI para tweeteo automatizado en X sobre tech, con aprendizaje de perfil y bot Telegram."  

**Entregables:** Repo inicial con estructura NestJS y README básico.  
**Riesgos:** Conflictos de dependencias; probar `npm install` en local.  

## Fase 2: Integraciones Básicas (4-5 días)
**Objetivo:** Conectar APIs y bot básico.  

1. Módulo Telegram (telegram.module.ts, telegram.service.ts):  
   - Usar grammy para bot.  
   - Comandos:  
     - `/start`: "¡Hola Matías! Estoy listo para tweetear sobre tech."  
     - `/aprender`: Trigger para análisis de perfil.  
     - `/generar`: Genera tweet propuesto.  
     - `/aprobar`: Publica el último generado.  
     - `/status`: "Último tweet: [link], Pi CPU: [info]."  
   - Enviar notificaciones push (e.g., "Tweet aprobado y publicado").  
   - Seguridad: Whitelist solo para tu Telegram ID.  

2. Módulo Twitter (twitter.module.ts, twitter.service.ts):  
   - Usar @twitter-api-v2/client con OAuth.  
   - Funciones:  
     - Fetch perfil (@sterzermatiass), likes (últimos 100), replies (últimos 50).  
     - Postear tweet (texto simple; media opcional futura).  
   - Rate limiting: Usar bottleneck para evitar bans.  

3. Integración Anthropic:  
   - Service global para llamadas a Claude Haiku (prompts fijos).  
   - Prueba inicial: Un hello world con AI.  

4. Configurar DB (app.module.ts):  
   - Usar TypeORM con SQLite: `dataSourceOptions: { type: 'sqlite', database: 'db.sqlite' }`.  

**Entregables:** Bot Telegram funcional (pruebas locales), fetches de Twitter, conexión AI.  
**Pruebas:** Usar Postman para APIs; simular comandos en Telegram.  
**Riesgos:** Límites de API; implementar retries.  

## Fase 3: Módulo de Aprendizaje (3 días)
**Objetivo:** Análisis estático de perfil.  

1. Crear entidad DB (src/entities/profile-summary.entity.ts):  
   ```typescript
   import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

   @Entity('user_profile_summary')
   export class ProfileSummary {
     @PrimaryGeneratedColumn()
     id: number;

     @Column('text')
     style: string; // Ej: "Cortos, irónicos, español, emojis 🔥"

     @Column('text')
     favorite_topics: string; // Ej: "Raspberry Pi, IA, hardware, open source"

     @Column('text')
     last_updated: string; // ISO timestamp
   }
   ```  

2. Lógica en learning.service.ts:  
   - En `/aprender`:  
     - Fetch datos de Twitter.  
     - Prompt a Claude: "Analiza estilo y temas basados en perfil, likes y replies. Devuelve JSON: {style: '...', favorite_topics: '...'}".  
     - Guardar en DB.  
     - Notificar: "Perfil actualizado. Estilo: [resumen]."  

3. Manejo de errores: Si fetch falla, fallback a resumen anterior.  

**Entregables:** Comando `/aprender` funcional, con datos en DB.  
**Pruebas:** Verificar JSON de Claude y storage.  
**Riesgos:** Datos sensibles; anonymizar si es necesario.  

## Fase 4: Generador de Tweets (3-4 días)
**Objetivo:** Generación y propuesta de tweets.  

1. En tweet-generator.service.ts:  
   - Cargar resumen de DB.  
   - Prompt fijo a Claude:  
     "Genera UN tweet (≤280 chars) sobre [tema tech actual]. Como @sterzermatiass: estilo {style}, temas {favorite_topics}. Natural, emojis, hashtags, argentino."  
   - Temas: Fetch ligero de RSS (e.g., xml2js para Hacker News o TechCrunch; 1-2 por día).  

2. Scheduler (scheduler.module.ts):  
   - Usar @nestjs/schedule: `@Cron('0 10 * * *')` para proponer tweet diario (10 AM ARG).  
   - Enviar propuesta a Telegram con botones (Sí/No via inline keyboard).  

3. Flujo de aprobación: `/generar` o scheduler → Propuesta → `/aprobar` → Publicar via Twitter service → Notificar.  

**Entregables:** Tweets generados y publicados manualmente.  
**Pruebas:** Verificar longitud, estilo y publicación.  
**Riesgos:** Contenido inapropiado; agregar revisión manual siempre.  

## Fase 5: Optimización para Raspberry Pi Zero 2W (2 días)
**Objetivo:** Asegurar ejecución eficiente y persistente.  

1. Optimizaciones:  
   - Código async, minimizar loops.  
   - Monitoreo: Agregar endpoint /health para CPU/RAM (usar os module).  

2. Deploy en Pi:  
   - Instalar Node/dependencies: `sudo apt update; sudo apt install nodejs npm`.  
   - `git pull`, `npm install`, `npm run build`.  
   - PM2: `npm i -g pm2; pm2 start dist/main.js --name cafe-x-agent`.  

3. Servicio Systemd:  
   - Crear `/etc/systemd/system/cafe-x-agent.service`:  
     ```
     [Unit]
     Description=cafe X Agent
     After=network.target

     [Service]
     ExecStart=/usr/bin/pm2-runtime start dist/main.js --name cafe-x-agent
     Restart=always
     User=pi
     Environment=PATH=/usr/bin:/usr/local/bin
     Environment=NODE_ENV=production

     [Install]
     WantedBy=multi-user.target
     ```  
   - `sudo systemctl enable cafe-x-agent`.  

4. Logs: Winston o console a archivos; enviar errores a Telegram.  

**Entregables:** Agente corriendo en Pi sin crashes.  
**Pruebas:** Monitorear 24h con htop.  
**Riesgos:** Bajo RAM; limitar fetches.  

## Fase 6: Testing y Lanzamiento (2-3 días)
**Objetivo:** Validar y deploy final.  

1. Tests:  
   - Unit: Jest para services (mock APIs).  
   - Integration: Flujos end-to-end (e.g., /aprender → /generar → /aprobar).  

2. Testing en Pi:  
   - Simular uso real; verificar notificaciones.  

3. Seguridad:  
   - Encriptar .env; whitelist estricta.  

4. Lanzamiento:  
   - Push final a GitHub.  
   - Documentar en README: "Para empezar: npm run start:prod en Pi."  

5. Métricas de Éxito:  
   - Agente responde en Telegram.  
   - Analiza perfil y genera tweets personalizados.  
   - Publica sin errores.  

**Entregables:** Repo completo, agente live en Pi.  
**Próximos Pasos:** Monitorear uso; agregar features como media si se necesita.  

Si necesitas ajustes o código para una fase específica, ¡avísame Matías! Este plan es flexible.

