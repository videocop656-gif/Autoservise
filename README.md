# Автосервис — AI-администратор (Foundation)

SaaS-приложение для автосервисов. Это **этап Foundation**: технический фундамент
(auth, multi-tenant, БД), без AI, интеграций и финального дизайна.

> Отдельный проект и кодбейс. Не связан с другими продуктами, не переиспользует
> их код, Supabase project, стили или настройки.

## Architecture

```
React + Vite + TypeScript (frontend)
        │  fetch, same-origin
        ▼
REST API — /api/**  (Vercel-compatible serverless functions)
        │
        ▼
Prisma ORM
        │
        ▼
PostgreSQL  (managed by Supabase)
```

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style components, lucide-react, react-router-dom.
- **Backend**: Node.js + TypeScript, plain REST endpoints under `/api`, written as Vercel serverless functions (`(req, res) => ...`). In dev, a small Vite plugin (`vite.config.ts`) serves these same handler files on the same port as the frontend, so `npm run dev` is the only command you need — no separate backend process, no CORS.
- **Database**: Supabase is used purely as a managed PostgreSQL provider. **Supabase Auth is not used** — authentication is custom (see below).
- **ORM**: Prisma (`prisma/schema.prisma`).
- **Validation**: Zod.
- **Auth**: email + password, Argon2id hashing, server-side sessions, HttpOnly cookies. No JWTs, no tokens in localStorage.

## Requirements

- Node.js 20+
- A Supabase account (free tier is enough)

## Supabase setup

1. Create a **new** Supabase project dedicated to this app (do not reuse another project).
2. In the Supabase dashboard: **Project Settings → Database → Connection string**.
3. Copy the **Transaction pooler** connection string (port `6543`) → this is your `DATABASE_URL`.
4. Copy the **Session/direct** connection string (port `5432`) → this is your `DIRECT_URL`.
5. Paste both into your local `.env` (see below).
6. Run the Prisma migration (see [Prisma](#prisma) below).
7. Start the app.

Never commit real connection strings.

## Environment

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

Variables:

| Variable         | Description                                                       |
|------------------|---------------------------------------------------------------------|
| `DATABASE_URL`   | Pooled Postgres connection string (used by the running app)         |
| `DIRECT_URL`     | Direct Postgres connection string (used by Prisma for migrations)   |
| `SESSION_SECRET` | Long random secret used to hash session tokens. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `NODE_ENV`       | `development` locally, `production` when deployed                   |
| `APP_URL`        | Public URL of the app (used for cookie/security decisions)          |

## Install

```bash
npm install
```

(`postinstall` runs `prisma generate` automatically.)

## Prisma

```bash
# Apply the schema to your Supabase database and create the first migration
npm run prisma:migrate

# Regenerate the Prisma client after any schema change
npm run prisma:generate

# Optional: inspect data with Prisma Studio
npm run prisma:studio
```

## Development

```bash
npm run dev
```

Opens the app at `http://localhost:5173`. Frontend and `/api/*` endpoints are served from the same Vite dev server.

Optional demo data (development only, refuses to run when `NODE_ENV=production`):

```bash
npm run seed
```

This creates a demo tenant with a **development-only** login:
`owner@example.com` / `DevOnlyPassword123!`

## Build

```bash
npm run typecheck   # TypeScript strict check, no emit
npm test            # Vitest — unit tests for critical security logic
npm run build       # typecheck + production frontend build (dist/)
```

Deployed on Vercel, the files under `/api` are automatically picked up as
serverless functions; no extra configuration is required.

## Authentication

- Passwords are hashed with **Argon2id** (`src/server/auth/password.ts`), OWASP-recommended parameters. Never logged, never stored in plain text.
- On register/login, the server generates a cryptographically random session token (`crypto.randomBytes`), sends it to the browser only via an **HttpOnly, SameSite=Lax** cookie (`Secure` in production), and stores only an HMAC-SHA256 hash of it (keyed by `SESSION_SECRET`) in the `sessions` table. The raw token never touches the database.
- Every authenticated request re-derives `user`/`tenant`/`role` server-side from the session cookie (`requireAuth`, `src/server/middleware/requireAuth.ts`) — these are **never** trusted from client input.
- Sessions last 30 days; `lastUsedAt` is refreshed on each authenticated request.
- Login returns the same generic `INVALID_CREDENTIALS` error whether the email doesn't exist or the password is wrong (including similar timing), to avoid user enumeration.
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Basic in-memory rate limiting on `/api/auth/register` and `/api/auth/login` (per warm serverless instance — not distributed; documented limitation, see `src/server/middleware/rateLimit.ts`). Swap in Redis/Upstash later without changing call sites if stronger guarantees are needed.
- The auth module is structured so `POST /api/auth/forgot-password` / `reset-password` can be added later without restructuring (no email provider wired up yet).

## Multi-tenancy

- One **Tenant** = one auto service company. Every user belongs to exactly one tenant; all business data is tied to a `tenantId`.
- Tenant isolation is enforced **server-side only** — never via frontend filtering. `tenantId` always comes from the authenticated session (`requireAuth`), never from client-supplied fields.
- The reusable `withTenant()` helper (`src/server/lib/tenantScope.ts`) is meant to be the one way tenant-owned queries build their `where` clause, so future endpoints don't accidentally forget the filter — see `businessRepository.listByTenant` for the pattern.
- Role-based checks (`owner`, `admin`, `manager`) via `requireRole()` (`src/server/middleware/requireRole.ts`).

## Security

- Argon2id password hashing, no custom crypto.
- Server-side sessions; only a hashed, HMAC-keyed token is persisted.
- HttpOnly / Secure (prod) / SameSite=Lax cookies; nothing auth-related in localStorage/sessionStorage.
- Zod validation on every auth input.
- Tenant isolation and role checks enforced server-side.
- Basic rate limiting on auth endpoints.
- Centralized error handling (`src/server/lib/errors.ts`) — no stack traces, SQL errors, env vars, or file paths ever reach the client.
- Structured logging (`src/server/lib/logger.ts`) with a redaction list covering passwords, hashes, tokens and secrets.
- No secrets committed (`.env` is gitignored; `.env.example` has no real values).

## Current scope (Prompt 01 — Foundation)

- Project scaffold: Vite + React + TS frontend, REST API backend, Prisma, Supabase Postgres.
- Multi-tenant data model: `Tenant`, `User`, `Business`, `Session`.
- Custom auth: register / login / logout / me, Argon2id, server-side sessions, HttpOnly cookies.
- Tenant isolation and role-authorization primitives.
- Zod validation, centralized error handling, basic rate limiting, structured logging.
- Minimal `/login`, `/register`, `/dashboard` pages with protected routing.
- Unit tests for password hashing, tokens, validation schemas, `requireAuth`, `requireRole`, tenant isolation, and the register/login/logout service logic.

## Not implemented yet

AI / LLM / OpenAI, AI receptionist, Telegram, WhatsApp, Avito, VK, MAX, website
chat, CRM, Kommo, Google Calendar, payments, subscriptions, billing,
analytics, automated follow-ups, SMS, voice AI, message generation, final
UI/UX & design system, marketing site, advanced dashboard.

These are intentionally out of scope for this stage. The codebase leaves room
for them (e.g. `AIProvider` / `CRMAdapter` / `CalendarAdapter` /
`ChannelAdapter` / `PaymentAdapter` integration layers, and domain models like
`Service`, `Lead`, `Conversation`, `Appointment`) without committing to their
shape yet.
