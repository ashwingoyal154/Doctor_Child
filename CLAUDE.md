# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # ts-node-dev with hot reload

# Build & run
npm run build        # tsc → dist/
npm start            # node dist/app.js

# Database
npm run db:generate  # prisma generate (after schema changes)
npm run db:migrate   # prisma migrate dev (creates migration files)
npm run db:push      # prisma db push (no migration file, dev only)
npm run db:studio    # open Prisma Studio
```

No test runner is configured yet.

## Environment Setup

Copy `.env.example` to `.env` and populate:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — minimum 32 characters
- `JWT_EXPIRES_IN` — token lifetime (default `7d`)

## Architecture

Express + TypeScript backend. PostgreSQL via Prisma. No frontend.

```
src/
  app.ts              # Express setup, route mounting, global error handler
  routes/             # Thin route handlers — validate input (Zod), call services
  services/           # Business logic
  middleware/
    auth.ts           # JWT verification → attaches req.user (JwtPayload)
    rbac.ts           # Role and ownership guards (see below)
  types/index.ts      # All shared interfaces + Express Request augmentation
  config/prisma.ts    # Singleton PrismaClient
```

### Core Domain: Consultation State Machine

The `Consultation` record is the central entity. Its `status` field drives all business logic:

```
AI_MANAGED → ESCALATING → DOCTOR_MANAGED → CLOSED
```

- **AI_MANAGED**: default state; AI guidance is generated and cached as `lastAiGuidanceSnapshot` on the record.
- **ESCALATING**: triggered by parent request, AI threshold, or admin override (`EscalationTrigger` enum). A regional doctor is assigned at this point.
- **DOCTOR_MANAGED**: assigned doctor calls `/accept`; `doctorAcceptedAt` is recorded.
- **CLOSED**: terminal. A new `Consultation` must be created for re-entry — no reopening.

See `docs/state-transition.md` for the full step-by-step flow and RBAC matrix.

### AI Guidance Service

`src/services/aiGuidanceService.ts` contains a **stub** (`runProprietaryModel`) that must be replaced with the real proprietary pediatric model. The function contract is stable — accept `PediatricModelInput`, return `PediatricModelOutput`. Everything outside that function is production-ready. Update `MODEL_VERSION` when wiring in the real model.

### Percentile Service

`src/services/percentileService.ts` uses simplified WHO/CDC z-score approximations. The `computeZScore()` function must be replaced with a full LMS table lookup (keyed on age/sex from the official WHO Child Growth Standards data files) before clinical use.

### RBAC Model

Three roles: `PARENT`, `DOCTOR`, `ADMIN`.

Middleware in `src/middleware/rbac.ts`:
- `requireRole(...roles)` — gate by role
- `requireChildAccess(param)` — parent must own the child; doctor/admin bypass
- `requireConsultationAccess(param)` — parent must own the consultation OR be the assigned doctor; admin bypass
- `requireHealthRecordAuthor` — doctor must be the record's `authorId`; admin bypass
- `filterHealthRecordsForRole(records, role)` — strips `isVisibleToParent: false` records from PARENT responses; must be called before serialising any `HealthRecord[]`

`HealthRecord.isVisibleToParent` defaults to `false`. Only the authoring doctor or admin can flip it via `PATCH /api/consultations/health-records/:id/visibility`.

### Key Database Invariants

- `HealthRecord.authorId` must always be a `DOCTOR` or `ADMIN` — enforced at the route layer.
- `Consultation.parentId` is immutable after creation.
- `Consultation.escalatedAt` is a one-time write.
- `GrowthMetric` records are append-only (no update endpoint).
- Doctor matching (`findAvailableDoctor`) uses `isAcceptingCases: true` filtered by optional `region`. If no doctor is found, the consultation stays `ESCALATING` with `doctorId = null` pending a retry mechanism (not yet implemented).
