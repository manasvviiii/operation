# Known Limitations — Operations OS

This document lists known limitations, scope cuts, and architectural constraints that are intentional but should be understood before extending or deploying the system.

## Schema & Migration

The `extractedFields` column on the `Workflow` model was applied directly via `npx prisma db push`, not a tracked migration file. This happened because the migration history on the shared Neon database had drifted during rapid iteration, causing `prisma migrate dev` to refuse without a full database reset. The column is present and functional, but there is no corresponding file under `prisma/migrations/` recording this change. Future schema changes should use `prisma migrate dev` to maintain a proper migration trail.

## Idempotency Mechanism

The idempotency guard in `src/lib/retry.ts` (`withIdempotency`) uses an **in-memory `Map`** to track completed operations. This means:
- Idempotency keys are **lost on process restart** — a server restart could allow duplicate ERP writes if the same workflow is re-triggered.
- The guard **does not work across multiple server instances** — if the app is deployed behind a load balancer with multiple replicas, each instance has its own independent store.

In production, this should be replaced with a persisted idempotency mechanism (e.g. a unique constraint in Postgres, or a Redis key with TTL).

## Worker Validation

The four info-collection workers (`doc_agent`, `gst_agent`, `pan_agent`, `bank_agent`) **always return `success: true`** regardless of whether they actually extracted valid data from the vendor's message. When a worker fails to find valid data (e.g. no GSTIN match in the message), it sends a re-prompt message asking the vendor to try again, but still reports success — meaning the state transition is not blocked.

The **planner's own LLM judgment** is what currently paces progression through the collection states (it decides whether to stay in the current state or advance). The workers are not yet a hard validation gate. This is a deliberate scope cut, not a bug, but should be treated as one for production hardening.

## PAUSED State (Rejected Approvals)

`PAUSED` (the state used when an approval is rejected) is effectively a **near-terminal state** in the current state machine. Its only legal transitions are to `FAILED` or `CANCELLED` — there is no path back into the normal onboarding flow (e.g. back to `AWAITING_GST` or `INITIATED`).

A rejected vendor currently requires **manual, out-of-band handling** to resubmit. When a rejection occurs, the vendor is notified via Telegram with the rejection reason and a note that the workflow is paused pending manual follow-up — so they are not left in silence — but the system does not support automated resubmission or reopening of a paused workflow.

## Prompt Versioning Coverage

Of the 5 agent types in the system, only **2 have versioned prompt files** under the `prompts/` directory:

| Agent | Prompt File | Status |
|---|---|---|
| `planner` | `prompts/planner/v1.md` | ✅ Versioned |
| `gst_agent` | `prompts/gst_agent/v1.md` | ✅ Versioned |
| `doc_agent` | — | ❌ Inline logic only |
| `pan_agent` | — | ❌ Inline logic only |
| `bank_agent` | — | ❌ Inline logic only |

The 3 agents with inline logic would follow the same `prompts/<agent>/<version>.md` pattern if extended.

## Mocked External Integrations

All external service integrations are **mocked** — they simulate behavior but do not call real APIs:

- **GST verification** (`gst_agent`): Extracts GSTIN via regex pattern matching, does not call the government GST portal API.
- **PAN verification** (`pan_agent`): Extracts PAN via regex, does not call a PAN validation service.
- **Bank verification** (`bank_agent`): Extracts IFSC code via regex, does not perform a penny-drop bank account verification.
- **Document handling** (`doc_agent`): Checks for the word "attachment" in the message content, does not integrate with S3/Textract or any OCR/storage service.
- **ERP write** (`erp_agent` / `erpConnector.ts`): Generates a fake record ID with a simulated ~15% transient failure rate (via `MOCK_FAILURE_RATE` constant) to exercise the retry path. Does not call SAP, NetSuite, Oracle, or any real ERP system.
