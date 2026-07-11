# Architecture — Operations OS

## Component Diagram

```mermaid
flowchart LR
    subgraph Telegram
        TG_IN["Telegram User (inbound)"]
        TG_OUT["Telegram Bot (outbound)"]
    end

    subgraph "Next.js Application"
        WEBHOOK["/api/telegram/webhook<br>or dev-poll.ts"]
        INBOUND["inboundHandler.ts"]
        LOOP["runAgentLoop.ts"]
        PLANNER["Planner Agent<br>(Groq / Llama 3.3 70B)"]
        SM["stateMachine.ts<br>validateTransition()"]
        WORKERS["Worker Dispatch<br>(doc/gst/pan/bank/erp)"]
        APPROVAL_ROUTE["/api/approvals/[id]/decide<br>(only exit from PENDING_APPROVAL)"]

        subgraph "Dashboard (read-only)"
            DASH_LIST["/dashboard — Workflow List"]
            DASH_DETAIL["/dashboard/workflows/[id]<br>Detail + Timeline"]
        end
    end

    subgraph "Postgres (Neon)"
        DB_W["Workflow"]
        DB_E["Execution"]
        DB_AR["AgentRun"]
        DB_M["Message"]
        DB_AP["Approval"]
        DB_AL["AuditLog"]
        DB_D["Document"]
    end

    HUMAN["Human Operator"]

    TG_IN -->|webhook POST / poll| WEBHOOK
    WEBHOOK --> INBOUND
    INBOUND -->|saves Message row| DB_M
    INBOUND --> LOOP
    LOOP --> PLANNER
    PLANNER -->|"{ targetState, nextWorker }"| SM
    SM -->|valid transition| LOOP
    LOOP -->|updates state| DB_W
    LOOP -->|creates rows| DB_E
    LOOP -->|creates rows| DB_AR
    LOOP -->|writes audit| DB_AL
    LOOP -->|if PENDING_APPROVAL| DB_AP
    PLANNER -.->|"plan.nextWorker (not yet dispatched)"| WORKERS
    LOOP -->|outbound reply| TG_OUT

    DASH_LIST -->|reads| DB_W
    DASH_DETAIL -->|reads| DB_W
    DASH_DETAIL -->|reads| DB_M
    DASH_DETAIL -->|reads| DB_AL
    DASH_DETAIL -->|reads| DB_E
    DASH_DETAIL -->|reads| DB_AR
    DASH_DETAIL -->|reads| DB_AP

    HUMAN -->|Approve / Reject| APPROVAL_ROUTE
    APPROVAL_ROUTE -->|validates via stateMachine| SM
    APPROVAL_ROUTE -->|updates Approval + Workflow| DB_W
    APPROVAL_ROUTE -->|writes AuditLog actor:human| DB_AL
```

## What's Implemented vs. Mocked

| Component | Status | Details |
|---|---|---|
| **Prisma schema** | ✅ Implemented | 8 models: Vendor, Workflow, Execution, AgentRun, Message, Approval, AuditLog, Document. Fully migrated to Postgres (Neon). |
| **State machine** | ✅ Implemented | `stateMachine.ts` — 11 states, explicit transition map, `validateTransition()` throws on invalid moves. Unit tested. |
| **Audit logging** | ✅ Implemented | `writeAuditLog()` creates an AuditLog row on every state transition, capturing actor, action, from/to states, and metadata. |
| **Execution + AgentRun tracking** | ✅ Implemented | `runAgentLoop.ts` creates an Execution row (status: running → done/failed) and an AgentRun row per planner invocation, recording tokens and latency. |
| **Telegram connector** | ✅ Implemented | `connectors/telegram.ts` — `normalizeUpdate()` parses incoming Telegram messages, `sendMessage()` sends outbound replies. Webhook route at `/api/webhook/telegram`. |
| **Dev polling** | ✅ Implemented | `scripts/dev-poll.ts` — runs `node-telegram-bot-api` in long-poll mode for local development without a public URL. |
| **Inbound handler** | ✅ Implemented | `inboundHandler.ts` — links chats to workflows via `/start <workflowId>`, persists inbound Messages, triggers the agent loop. |
| **Approval gate** | ✅ Implemented | `/api/approvals/[id]/decide` — the only code path that can move a workflow out of `PENDING_APPROVAL`. Validates transition, updates Approval row, writes AuditLog with `actor: "human"`. |
| **Operator dashboard** | ✅ Implemented | Server Components reading Prisma directly. Workflow list (sorted, state-badged), detail page with vendor info, and a chronological merged timeline of Messages + AuditLogs + Executions + AgentRuns. |
| **Approval UI** | ✅ Implemented | Client component (`ApprovalPanel.tsx`) with Approve/Reject buttons, decidedBy and reason inputs, POSTs to the approval route, then calls `router.refresh()`. |
| **Planner agent** | ✅ Real LLM, working, no retry | `planner.ts` calls **Groq** (`llama-3.3-70b-versatile`) via the `groq-sdk` with JSON-mode output. It receives workflow context (state, vendor, last 10 messages, last 10 audit logs) and returns `{ nextWorker, targetState, reasoningSummary }`. Response is validated with Zod. Verified end-to-end against the live database — a test workflow correctly transitioned `INITIATED` → `AWAITING_GST` based on a real planner call. There is no retry/backoff logic — a single API failure or rate-limit will throw and mark the execution as failed. The planner was previously built against Anthropic Claude, then Gemini 2.0 Flash, before settling on Groq due to free-tier quota constraints with the earlier two providers. |
| **Worker agents** | ❌ Not built | The planner returns a `nextWorker` field (one of `doc_agent`, `gst_agent`, `pan_agent`, `bank_agent`, `erp_agent`), but no worker dispatch or execution logic exists. The agent loop transitions state based on the planner's decision alone without running worker-specific logic. |

## Deployment Considerations

In a real production deployment, the Telegram webhook route would need a public HTTPS URL (via Vercel, a reverse proxy, or a tunnel like ngrok) instead of the local `dev-poll.ts` long-poll script. The `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, and `GROQ_API_KEY` should be stored in a proper secrets manager (e.g. Vercel environment variables, AWS Secrets Manager) rather than a local `.env` file. The planner should include retry/backoff logic for LLM rate limits and transient failures, and ideally a fallback model. The five worker agents need real implementations that call external APIs (GST/PAN validation services, bank account verification, ERP system writes). Finally, structured logging (e.g. Pino or OpenTelemetry) and monitoring/alerting should be added to track agent loop failures, LLM latency, and approval queue depth.