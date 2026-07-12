<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Operations OS — Agent Architecture Guide

This file is the authoritative reference for how the agent orchestration system
works. Read it before modifying any file in `src/lib/`.

---

## Planner Agent

**File:** `src/lib/agents/planner.ts`
**Provider:** Groq (`llama-3.3-70b-versatile`) via `groq-sdk`. Not Claude. Not Gemini. Not OpenAI.

The planner receives a `PlanContext` object containing:
- Current workflow state and step
- Vendor identity
- Recent messages and audit log history
- Optional `FailureContext` (when a previous worker failed operationally)

It returns a structured plan validated by Zod:
```ts
{ nextWorker: string; targetState: string; reasoningSummary: string }
```

The Groq call is wrapped in `withRetry` (up to 4 attempts, exponential backoff
starting at 300ms). Token usage (`promptTokens`, `completionTokens`,
`totalTokens`) comes directly from the Groq API response. `estimatedCost` is
always `null` — no pricing is hardcoded.

**The planner is an advisor. The state machine is the authority.**

---

## Deterministic State Machine

**File:** `src/lib/stateMachine.ts`

`validateTransition()` enforces a strict `TRANSITION_MAP`. Any planner proposal
that violates the legal transition topology is rejected before the database is
touched. This means even a hallucinating LLM cannot skip steps or jump to
impossible states.

---

## Worker Dispatch and WorkerResult

**File:** `src/lib/agents/workers/index.ts` (dispatcher)

Workers are dispatched by `runAgentLoop` using `dispatchWorker(plan.nextWorker, context)`.

Each worker returns a `WorkerResult`:
```ts
{
  success: boolean;
  validationPassed?: boolean;
  outboundMessage?: string;
  extractedData?: Record<string, unknown>;
  error?: string;
  retryable?: boolean;
}
```

Workers perform real deterministic validation (regex, algorithmic checks).
A missing or invalid document triggers `validationPassed: false`.

---

## Technical Failure Gate vs Business Validation Gate

`runAgentLoop` enforces two sequential gates after every worker dispatch:

**Technical Failure Gate** (`!workerResult.success`)
- Triggered when the worker throws an unrecoverable exception or returns
  `success: false`.
- If `replanCount < MAX_REPLANS`: triggers bounded replanning.
- If `replanCount >= MAX_REPLANS`: marks execution as `failed` and returns.

**Business Validation Gate** (`!workerResult.validationPassed`)
- Triggered when the worker completed successfully but the document/data
  did not meet business rules (e.g. blurry document, mismatched GSTIN).
- Does **not** trigger replanning.
- Sends a correction prompt to the vendor and marks execution as `done`.
- Waits for the vendor to resubmit.

---

## Bounded Failure-Aware Replanning

`MAX_REPLANS = 1` is enforced by a `while (replanCount <= MAX_REPLANS)` loop
inside `runAgentLoop`. When the Technical Failure Gate triggers a replan:

1. Failure is classified using `classifyFailure()` (failure taxonomy).
2. A `FailureContext` is constructed and redacted via `redactForObservability`.
3. A `REPLAN_REQUESTED` event is appended to the AgentEvent timeline.
4. `context.failureContext` is set for the next planner call.
5. `replanCount` is incremented and `plan` is reset to `null`.
6. The loop continues: the planner is called again with the failure context.
7. The corrected plan goes through **the same** routing and validation gates.

`MAX_REPLANS = 1` is **loop-local**. It resets across independent invocations.

---

## FailureContext

```ts
interface FailureContext {
  failedWorker: string;
  failureClass: string;     // from classifyFailure() taxonomy
  errorSummary: string;     // redacted via redactForObservability()
  attemptNumber?: number;
  previousPlanIntent?: string;
}
```

The planner prompt explicitly instructs the LLM to use this context to propose
a different recovery action rather than blindly repeating the failed action.

---

## Canonical Worker Failure Event

A worker operational failure is represented as **`WORKER_RESULT` with
`status='failed'`** in the AgentEvent timeline. There is no separate
`WORKER_FAILED` event type. This prevents duplicate timeline metadata and
maintains a single unambiguous vocabulary.

---

## Retry vs Replanning — Key Distinction

| Mechanism | Scope | When Used |
|---|---|---|
| `withRetry` | Local to one function call | Transient HTTP/API errors (429, 5xx) |
| `MAX_REPLANS` | Within one `runAgentLoop` invocation | Hard worker operational failure after retries exhausted |

Replanning invokes the LLM again. Retry does not. They are never mixed.

---

## ConnectorRegistry and Connector Abstraction

**File:** `src/lib/connectors/registry.ts`

All outbound messaging goes through `getConnector(channelType)`. Business
logic never imports `TelegramConnector` directly. This keeps the agent loop
channel-agnostic.

Current supported channels:
- `telegram` → `TelegramConnector`
- `erp` → `ErpConnector`

---

## Idempotency Ownership Rules

**Inbound:** Telegram `update_id` is claimed via a Prisma unique constraint.
P2002 losers yield immediately and do not process the event.

**Outbound:** A stable semantic idempotency key (e.g.,
`outbound:<workflowId>:<executionId>:<step>`) is used to create a `Message`
claim row **before** making the Telegram HTTP request. If P2002 fires, the
loser checks the existing row's `externalMessageId`. If it is set, the message
was already sent — suppress. If it is null, the race is in progress — yield.

---

## Observability Redaction Boundary

**File:** `src/lib/observability/redaction.ts`

`redactForObservability(value)` is a recursive masking utility hooked directly
into `appendAgentEvent`. It uses explicit field-key targeting and pattern-based
regex scrubbing. It does **not** use naive string-length heuristics to detect
document content.

---

## AgentEvent Timeline

**File:** `src/lib/observability/agentTimeline.ts`

The timeline is **append-only**. Events are written via `appendAgentEvent()`.

Canonical event vocabulary:
- `LOOP_STARTED`
- `PLAN_CREATED`
- `WORKER_DISPATCHED`
- `WORKER_RESULT` (status: `success` or `failed`)
- `REPLAN_REQUESTED`
- `RETRY_SCHEDULED`
- `VALIDATION_FAILED`
- `VALIDATION_PASSED`
- `STATE_TRANSITION`
- `EXECUTION_COMPLETED`
- `EXECUTION_FAILED`

Do not add new event types without updating this list and the timeline UI.
