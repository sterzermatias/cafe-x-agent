# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cafe-x-agent is a NestJS AI agent for X (Twitter) that generates and publishes tweets on any relevant topic, learning from the user's profile (@sterzermatiass), likes, retweets, previous tweets, and "For You" feed. It uses a Telegram bot for approvals/notifications and runs on a Raspberry Pi Zero 2W.

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
- **TelegramModule** — grammy bot, commands (`/start`, `/aprender`, `/generar`, `/status`), inline keyboard approvals, user whitelist
- **TwitterModule** — `twitter-api-v2` client with bottleneck rate limiting. Methods: `fetchProfile()`, `fetchLikes()`, `fetchUserTweets()`, `fetchHomeFeed()`, `postTweet()`
- **AnthropicModule** — Claude Haiku wrapper for profile analysis, feed summarization, tweet generation
- **LearningModule** — Analyzes profile + interactions + feed via Twitter & Anthropic, persists ProfileSummary and FeedSnapshot
- **TweetGeneratorModule** — Generates tweets using profile context + feed, handles approve/reject flow
- **SchedulerModule** — `@nestjs/schedule` crons: feed capture 2x/day, daily tweet proposal
- **HealthModule** — `GET /health` endpoint for Pi monitoring

**Database:** SQLite via TypeORM (`better-sqlite3`). Entities: `ProfileSummary`, `GeneratedTweet`, `FeedSnapshot`.

## Code Style

- Single quotes, trailing commas (Prettier config in `.prettierrc`)
- ESLint flat config with TypeScript and Prettier integration
- `@typescript-eslint/no-explicit-any`: off
- Target: ES2023, module: nodenext
- Unit tests: `src/**/*.spec.ts` — E2E tests: `test/**/*.e2e-spec.ts`
