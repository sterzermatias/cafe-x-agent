# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cafe-x-agent is a NestJS AI agent for X (Twitter) that generates and publishes tweets on any relevant topic, learning from the user's tweet export (one-time seed), RSS feeds, and manual input via Telegram. The X API Free tier is publish-only (no reading likes/timeline/search). It uses a Telegram bot for approvals/notifications/topic input and runs on a Raspberry Pi Zero 2W.

Architecture and implementation plans are in `.claude/architecture-plan.md` and `.claude/implementation-plan.md`.

## Commands

```bash
npm run start:dev      # Dev mode with watch
npm run start:debug    # Dev mode with debugger
npm run build          # Compile to dist/
npm run start:prod     # Run compiled app (node dist/main)
npm run lint           # ESLint with auto-fix
npm run format         # Prettier format
npm test               # Unit tests (Jest)
npm run test:watch     # Unit tests in watch mode
npm run test:cov       # Unit tests with coverage
npm run test:e2e       # E2E tests (supertest)
```

Run a single test file: `npx jest --testPathPattern=<filename>`

## Architecture

NestJS 11 modular architecture with these planned modules:

- **ConfigModule** — `@nestjs/config` with env validation
- **TelegramModule** — grammy bot, commands (`/start`, `/aprender`, `/generar`, `/tema`, `/status`), inline keyboard approvals with rejection reasons, user whitelist
- **TwitterModule** — `twitter-api-v2` publish-only (Free tier). Methods: `postTweet()`, `deleteTweet()`, `lookupUser()`
- **RSSModule** — `rss-parser` for configurable RSS feeds, captures trending content (replaces Twitter reading)
- **AnthropicModule** — Claude API wrapper with model selection: Haiku for analysis/summarization/validation, Sonnet for tweet generation
- **LearningModule** — Analyzes tweet export + RSS content + manual input via Anthropic, persists ProfileSummary and ContentSnapshot
- **TweetGeneratorModule** — Generates tweets using profile context + RSS content + feedback loop (approved/rejected tweets as few-shot), handles approve/reject with reasons, full traceability
- **SchedulerModule** — `@nestjs/schedule` crons: RSS content capture 2x/day, daily tweet proposal
- **HealthModule** — `GET /health` endpoint for Pi monitoring

**Database:** SQLite via TypeORM (`better-sqlite3`). Entities: `ProfileSummary`, `GeneratedTweet` (with rejection_reason, generation_context, FK traceability), `ContentSnapshot` (replaces FeedSnapshot).

## Code Style

- Single quotes, trailing commas (Prettier config in `.prettierrc`)
- ESLint flat config with TypeScript and Prettier integration
- `@typescript-eslint/no-explicit-any`: off
- Target: ES2023, module: nodenext
- Unit tests: `src/**/*.spec.ts` — E2E tests: `test/**/*.e2e-spec.ts`
