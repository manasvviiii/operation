# Operations OS — Vendor Onboarding Workflow

An AI-agent-driven vendor onboarding system. A vendor is guided through document, GST, PAN, and bank-detail collection over Telegram, with an LLM planner orchestrating which step runs next, a human approval gate before ERP write-back, and a dashboard for visibility into every workflow's state.

## How it works

1. An internal user creates a vendor + workflow (`scripts/newWorkflow.ts`) and gets a Telegram deep link.
2. The vendor taps the link and chats with the bot. Every inbound message is normalized, matched to its workflow, and handed to an **agent loop**.
3. The agent loop calls a **planner** (Groq/Llama, via `planner.ts`) to decide the next state and which worker agent should run.
4. A **worker agent** (`gst_agent`, `pan_agent`, `bank_agent`, `doc_agent`, or `erp_agent`) processes the input, extracts structured data, and replies to the vendor.
5. Once all required data is collected, the workflow enters `PENDING_APPROVAL` and waits for a human reviewer on the dashboard.
6. On approval, the workflow moves to `WRITING_ERP`, the `erp_agent` writes the vendor record to the ERP system, and the workflow reaches `COMPLETED`.

Every planner decision, worker run, and state transition is recorded (`Execution`, `AgentRun`, `AuditLog`) for traceability.

## Architecture

```
Telegram ──▶ /api/webhook/telegram (production)
         or  scripts/dev-poll.ts   (local dev, long-polling)
                    │
                    ▼
           inboundHandler.ts  ── resolves chatId/workflowId → workflow
                    │
                    ▼
            runAgentLoop.ts   ── orchestrates one planning + worker cycle
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
   planner.ts               agents/workers/*.ts
  (Groq LLM, validates      (doc, gst, pan, bank, erp —
   against state machine)    all mocked except erp_agent)
                    │
                    ▼
              Prisma / Neon Postgres
```

**State machine:** `INITIATED → AWAITING_GST → AWAITING_PAN → AWAITING_BANK → VALIDATING → PENDING_APPROVAL → WRITING_ERP → COMPLETED`, with `FAILED` / `CANCELLED` / `PAUSED` reachable from most states. Legal transitions are enforced by `stateMachine.ts` and checked both by the planner (self-correcting) and by `runAgentLoop.ts` (hard backstop).

**Delivery channel:** Telegram, via webhook in production (`src/app/api/webhook/telegram/route.ts`) or long-polling locally (`scripts/dev-poll.ts`). Only one mode can be active at a time — registering a webhook with Telegram disables `getUpdates` polling.

## Requirements

- Node.js
- A [Neon](https://neon.tech) Postgres database (or any Postgres reachable via `DATABASE_URL`)
- A Telegram bot token ([@BotFather](https://t.me/BotFather))
- A [Groq](https://groq.com) API key (planner LLM)

## Environment variables

Create a `.env` file:

```
DATABASE_URL=postgresql://...
TELEGRAM_BOT_TOKEN=...
GROQ_API_KEY=...
```

Set the same variables in your deployment platform's environment settings (e.g. Vercel Project → Settings → Environment Variables) — a local `.env` is not read in production.

## Local development

Install dependencies and generate the Prisma client:

```bash
npm install
npx prisma generate
```

Apply the schema to your database:

```bash
npx prisma db push
```

Start the Next.js dashboard:

```bash
npm run dev
```

In a **separate terminal**, start the Telegram long-poller (local dev only — do not run this alongside a registered webhook):

```bash
npx tsx scripts/dev-poll.ts
```

Create a test vendor + workflow:

```bash
npx tsx scripts/newWorkflow.ts "Vendor Legal Name"
```

This prints a Telegram deep link (`https://t.me/<bot_username>?start=<workflow-id>`) — tap it to begin onboarding.

### Resetting test data

```bash
npx tsx scripts/clearAll.ts
```

Deletes all `Vendor`, `Workflow`, `Message`, `Execution`, `AgentRun`, `Approval`, `AuditLog`, and `Document` rows. Irrevocable — intended for dev/test databases only.

## Testing

```bash
npx vitest
```

Worker agents are unit-tested against mocked inputs (`workers.test.ts`); the approvals API route has its own test file.

## Deployment (Vercel)

1. Set all required env vars in the Vercel dashboard.
2. Push to the connected Git branch, or run `vercel --prod`.
3. Register the Telegram webhook against your deployed URL:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.vercel.app/api/webhook/telegram
   ```
4. Stop running `scripts/dev-poll.ts` once the webhook is registered.

`next.config.ts` explicitly bundles the `prompts/` directory (via `outputFileTracingIncludes`) since the planner reads prompt files off disk at runtime and Vercel's function bundler doesn't trace that automatically.

## Known limitations (mocked / demo scope)

- `doc_agent`, `gst_agent`, `pan_agent`, and `bank_agent` are **mocks** — they extract data with regexes and never call a real verification service (NSDL, GST portal, bank penny-drop API, OCR). Only `erp_agent` calls a real connector (`ErpConnector`).
- Document detection (`doc_agent`) checks for the literal word `"attachment"` in message text — it does not inspect real Telegram file/photo uploads.
- The planner is an LLM and is not guaranteed correct on every call; `runAgentLoop.ts` and `planner.ts` both include safeguards (self-correcting retries, and a hard backstop that never advances state on an illegal transition or drops extracted data), but a wrong `nextWorker` choice can still occasionally produce a redundant re-prompt.
- The webhook route always returns `{ ok: true }` to Telegram even if processing throws internally — failures are visible only in server logs, not to the vendor or via a Telegram retry.

## Project structure

```
src/
  app/
    api/
      webhook/telegram/route.ts       # Telegram webhook receiver (production)
      approvals/[id]/decide/route.ts  # Human approval decision endpoint
    dashboard/                        # Workflow visibility UI
  lib/
    inboundHandler.ts                 # Resolves chatId/workflowId → workflow, logs message
    runAgentLoop.ts                   # Core orchestration: plan → dispatch worker → transition
    stateMachine.ts                   # Legal state transition graph
    connectors/
      telegram.ts                    # normalizeUpdate, sendMessage, bot instance
      telegramConnector.ts           # Connector interface implementation
      erpConnector.ts                # Real ERP integration
    agents/
      planner.ts                     # LLM-based next-step planner
      workers/
        doc_agent.ts
        gst_agent.ts
        pan_agent.ts
        bank_agent.ts
        erp_agent.ts
        index.ts                     # Worker registry + dispatch
prompts/
  planner/v1.md                       # Planner system prompt
scripts/
  dev-poll.ts                         # Local Telegram long-polling (dev only)
  newWorkflow.ts                      # Create a test vendor + workflow
  clearAll.ts                         # Wipe all workflow data (dev only)
prisma/
  schema.prisma                       # Vendor, Workflow, Message, Execution, AgentRun, Approval, AuditLog, Document
```