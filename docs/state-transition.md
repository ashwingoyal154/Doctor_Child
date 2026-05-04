# Consultation State Transition: AI-Managed → Doctor-Managed

## Overview

Every care episode for a child is represented by a **Consultation** record with a `status` field that acts as a state machine. The system begins in an AI-managed mode and can escalate to a human physician. All transitions are append-only — previous states are preserved in the audit trail.

---

## State Machine

```
┌──────────────┐    escalate()     ┌─────────────┐   accept()    ┌─────────────────┐
│  AI_MANAGED  │ ────────────────► │  ESCALATING │ ────────────► │ DOCTOR_MANAGED  │
└──────────────┘                   └─────────────┘               └─────────────────┘
       │                                  │                               │
       │         (admin override)         │                         close()
       └──────────────────────────────────┘                               ▼
                                                                      ┌────────┐
                                                                      │ CLOSED │
                                                                      └────────┘
```

**Terminal states:** `CLOSED`  
**Re-entry:** Not permitted. A closed consultation cannot be reopened; a new Consultation record must be created.

---

## Transition Triggers

| Trigger | Who initiates | Description |
|---|---|---|
| `USER_REQUESTED` | Parent | Parent explicitly taps "Speak to a Doctor" in the app |
| `AI_THRESHOLD_MET` | System/AI service | `generateAiGuidance()` returns `escalationAdvised: true` |
| `ADMIN_OVERRIDE` | Admin | Manual escalation by a platform administrator |

---

## Step-by-Step Flow

### Phase 1 — AI-Managed

1. Parent submits child metrics via `POST /api/metrics/calculate-percentile`.
2. App calls `POST /api/ai-guidance/generate` with the child profile and conditions.
3. The AI service (`generateAiGuidance`) runs the proprietary pediatric model and returns:
   - Nutrition recommendations
   - Supplement recommendations  
   - `escalationAdvised: boolean`
4. The guidance snapshot is cached as `lastAiGuidanceSnapshot` on the Consultation record so doctors have immediate context.
5. **If `escalationAdvised = false`:** flow remains in `AI_MANAGED`. Parent continues to receive AI guidance on subsequent visits.

### Phase 2 — Escalation

6. **Trigger:** Either the AI returns `escalationAdvised: true` (client shows a prompt) or the parent manually requests a doctor.
7. App calls `POST /api/consultations/escalate` with:
   ```json
   {
     "consultationId": "...",
     "trigger": "AI_THRESHOLD_MET" | "USER_REQUESTED",
     "parentNotes": "optional free-text",
     "preferredRegion": "optional"
   }
   ```
8. `escalateConsultation()` in the service layer:
   - Validates current state is `AI_MANAGED` or `ESCALATING` (idempotency guard — prevents double-escalation).
   - Writes `escalatedAt`, `escalationTrigger` to the record.
   - Calls `findAvailableDoctor(preferredRegion)` — queries `DoctorProfile` where `isAcceptingCases = true`, filtered by region.
   - Sets `doctorId` and transitions status to `ESCALATING`.
9. If no doctor is available in the preferred region, the status stays `ESCALATING` with `doctorId = null`; a background job (not yet implemented) should periodically re-run the matching query.

### Phase 3 — Doctor-Managed

10. The assigned doctor receives a notification (notification delivery layer is external to this service).
11. Doctor calls `POST /api/consultations/:id/accept`.
12. `acceptConsultation()` validates:
    - Status is `ESCALATING`.
    - Caller's `userId` matches `consultation.doctorId`.
13. Status transitions to `DOCTOR_MANAGED`, `doctorAcceptedAt` is recorded.
14. Doctor reads the `lastAiGuidanceSnapshot` for context and creates `HealthRecord` entries as needed.

### Phase 4 — Close

15. After resolution, the doctor or admin calls `POST /api/consultations/:id/close`.
16. Status transitions to `CLOSED`, `closedAt` is recorded.

---

## RBAC & Data Visibility

The system enforces a **two-tier visibility model**:

### Role Capabilities

| Capability | PARENT | DOCTOR | ADMIN |
|---|:---:|:---:|:---:|
| View own children's data | ✅ | — | ✅ |
| View all children's data | ❌ | own consults | ✅ |
| Generate AI guidance | ✅ | — | ✅ |
| Escalate consultation | ✅ | — | ✅ |
| Accept consultation | — | ✅ | — |
| Create HealthRecord | ❌ | ✅ | ✅ |
| Toggle `isVisibleToParent` | ❌ | own records | ✅ |
| Read private HealthRecord | ❌ | ✅ | ✅ |
| Read public HealthRecord | ✅ | ✅ | ✅ |

### `isVisibleToParent` — The Core RBAC Gate

The `HealthRecord.isVisibleToParent` boolean is the primary mechanism for physician-controlled data visibility:

- **Default:** `false` — all clinical records are private to the doctor by default.
- **Flip:** Only the authoring doctor (`authorId === user.id`) or an `ADMIN` may call `PATCH /api/consultations/health-records/:id/visibility`.
- **Enforcement:** The `filterHealthRecordsForRole()` utility function in `src/middleware/rbac.ts` strips records where `isVisibleToParent = false` before any `PARENT`-role response is serialised.
- **Consistency:** This filter is applied in two places — the `GET /api/consultations/:id` route and any future list endpoints — to prevent accidental leakage.

### Consultation Access Guards

- `requireChildAccess` — verifies a PARENT owns the child being accessed; DOCTOR/ADMIN bypass.
- `requireConsultationAccess` — verifies the PARENT owns the consultation OR the DOCTOR is the assigned physician; ADMIN bypass.
- `requireHealthRecordAuthor` — verifies the DOCTOR authored the record before allowing mutation; ADMIN bypass.

---

## Key Database Invariants

1. A `HealthRecord.authorId` must always reference a `DOCTOR` or `ADMIN` user — enforced at the route layer via `requireRole("DOCTOR", "ADMIN")`.
2. `Consultation.parentId` is immutable after creation.
3. `Consultation.escalatedAt` is a one-time write; re-escalation does not overwrite it.
4. `GrowthMetric` records are append-only; no update endpoint is provided to preserve a historical audit trail.
