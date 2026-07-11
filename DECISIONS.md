# Design Decisions — Operations OS

## Why TypeScript End-to-End

The entire stack — Next.js frontend, Prisma data access, agent orchestration logic, API routes — is written in TypeScript. This eliminates serialization boundaries between services, lets the dashboard server components query the same Prisma client that the agent loop writes to, and means a single `tsconfig.json` catches type errors across the full codebase. The tradeoff is that a Python-based agent framework (LangChain, CrewAI) would offer richer LLM tooling out of the box, but the unified type safety and deployment simplicity was worth more at this stage.

## Why Prisma + Postgres (Neon) with a Driver Adapter

Postgres was chosen because the data model is inherently relational — workflows have many messages, executions, approvals, and audit logs, and queries like "show me all activity for workflow X sorted by time" are natural joins. Neon was chosen for its serverless Postgres offering with instant provisioning. Prisma 7 introduced a new configuration system (`prisma.config.ts`) and requires a driver adapter (`@prisma/adapter-neon`) for serverless-compatible connection pooling over WebSockets — the standard `pg` driver doesn't work in edge/serverless environments without it.

> [!NOTE]
> The `extractedFields` schema change was applied directly via `npx prisma db push` due to migration history drift on the shared Neon database during rapid iteration. Developers should continue using `migrate dev` for future schema enhancements.

## Why the State Machine Is Enforced in Code

The `stateMachine.ts` module maintains an explicit `TRANSITION_MAP` that defines which state transitions are legal, and `validateTransition()` throws on any illegal move. This is a deliberate safety layer — even though the LLM planner proposes the target state, its suggestion is validated before the database is touched. Without this, a hallucinating or confused model could skip steps (e.g. jump from `INITIATED` straight to `COMPLETED`) or create impossible states. The state machine is the source of truth; the LLM is an advisor.

## Why the Approval Gate Is Structurally Enforced

Only one code path — `POST /api/approvals/[id]/decide` — can move a workflow out of `PENDING_APPROVAL`. The agent loop itself creates the `Approval` row and then halts (`return`), never attempting to advance past that state. This ensures a human must explicitly approve or reject before the workflow can proceed to `WRITING_ERP`. If the approval gate were just a convention the agent loop chose to respect, a bug or prompt injection in the planner could bypass it. Making it structural eliminates that class of failure.

## What Was Stubbed or Deferred

The **planner agent** is a real, working LLM integration — it receives workflow context and returns a structured plan validated by Zod, and has been verified end-to-end against the live database (a seeded workflow correctly transitioned from `INITIATED` to `AWAITING_GST` based on the planner's live output). The planner went through two provider swaps during the build window due to credit/quota constraints: it was first built against Anthropic's Claude SDK (`@anthropic-ai/sdk` is still in `package.json`, unused), then switched to Google's Gemini 2.0 Flash (blocked by a zero-quota free tier limit), and finally switched to **Groq** (`llama-3.3-70b-versatile`), which is the current, working implementation. The Groq call is wrapped in `withRetry` with up to 4 attempts and exponential backoff starting at 300ms, so transient API failures and rate-limit errors are retried automatically before the execution is marked as failed. The **five worker agents** (`doc_agent`, `gst_agent`, `pan_agent`, `bank_agent`, `erp_agent`) are now implemented as mock workers dispatched by `runAgentLoop.ts`. They extract data via regex (GST, PAN, IFSC), acknowledge document uploads, and simulate ERP writes. They do not call real external APIs — this was a deliberate scope cut prioritizing the orchestration skeleton, LLM integration, and observability infrastructure over real external service integrations.

The four info-collection workers (`doc_agent`, `gst_agent`, `pan_agent`, `bank_agent`) currently always return `success: true` regardless of whether they extracted valid data — a missing or invalid GST or PAN triggers a re-prompt message but does not block the state transition. The planner's own judgment is what currently paces progression through the collection states; the workers are not yet a hard validation gate. This is a deliberate scope cut, not a bug, but should be treated as one for production hardening.

`PAUSED` (used for rejected approvals) is a terminal-ish state in the current state machine — it can only transition to `FAILED` or `CANCELLED`, with no path back into the normal onboarding flow. A rejected vendor currently requires manual/out-of-band handling to resubmit. The rejection decision does send the vendor a Telegram message explaining the reason and noting that the workflow is paused pending manual follow-up, so they are not left with silence, but resubmission itself is not automated.

## What Would Change for Production

- **Secrets management**: Move `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, and `GROQ_API_KEY` from a `.env` file to a proper secrets manager (Vercel env vars, AWS Secrets Manager, etc.).
- **Retry and backoff**: The planner already wraps its Groq call in `withRetry` (4 attempts, exponential backoff from 300ms). Consider adding a fallback model (e.g. fall back to a cheaper model if the primary is unavailable) and circuit-breaking for extended outages.
- **Worker agents**: Build the 5 worker agents to call real external APIs — GST verification (government portal), PAN validation, bank account verification (penny drop), and ERP system writes via API.
- **Webhook infrastructure**: Replace `dev-poll.ts` with a production webhook setup — deploy to Vercel or a similar platform with a stable public HTTPS URL, and register it with Telegram's `setWebhook` API.
- **LLM quotas**: Move off free-tier or trial LLM quotas to a paid plan with guaranteed rate limits and SLAs.
- **Observability**: Add structured logging (Pino or similar), OpenTelemetry tracing for agent loop executions, and alerting on failed executions, high LLM latency, and stale approval queues.
- **Database**: Add connection pooling (PgBouncer or Neon's built-in pooler), database backups, and consider row-level security if multi-tenant.