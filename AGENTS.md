# Code Review Rules

## TypeScript
- Use const/let, never var
- Prefer interfaces over types for object shapes
- Single quotes, trailing commas (Prettier)
- Target: ES2023, module: nodenext

## NestJS
- One module per domain concept
- Services are @Injectable, modules use @Module
- Use OnModuleInit for async initialization
- ConfigService for all env access

## Code Style
- ESLint flat config with TypeScript and Prettier
- No explicit any (warning level)
- Unit tests: `src/**/*.spec.ts`
- E2E tests: `test/**/*.e2e-spec.ts`
