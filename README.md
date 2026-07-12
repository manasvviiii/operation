# Operations OS --- AI Vendor Onboarding

Operations OS is a hybrid AI vendor-onboarding orchestration system that combines a
Telegram assistant, structured LLM planning, deterministic state-machine authority, 
document validation, human approval, and idempotent ERP-style vendor creation.

The workflow collects and validates vendor documents step by step,
prevents skipped prerequisites, routes completed packets to a human
approval dashboard, and generates a vendor code only after approval.

## Features

-   Telegram-based guided vendor onboarding
-   Structured LLM planner
-   Specialized worker dispatch
-   Deterministic state-machine authority
-   Bounded failure-aware replanning (MAX_REPLANS = 1)
-   FailureContext injection
-   Append-only AgentEvent timeline
-   Retry lifecycle observability and failure taxonomy
-   Connector abstraction and registry
-   Telegram inbound idempotency
-   Telegram outbound idempotency
-   Approval traceability
-   Connector lifecycle telemetry
-   Centralized observability redaction
-   GST certificate upload and GSTIN validation
-   PAN format and document validation
-   Bank proof validation with IFSC and account details extraction
-   Company incorporation proof validation
-   GST and incorporation company-name consistency checks
-   Signed Vendor Agreement classification and signature evidence detection
-   PDF text extraction and image OCR
-   Vercel Blob document storage
-   MIME type and file-size validation
-   SHA-256 document checksums
-   Duplicate document protection
-   Out-of-order PAN handling
-   Deterministic prerequisite guards
-   Human-only dashboard approval
-   Idempotent ERP/vendor creation
-   Telegram status notifications
-   COMPLETED terminal-state protection
-   Audit logs, executions, and agent-run persistence

## Workflow

``` text
INITIATED
    ↓
AWAITING_GST
    ↓
AWAITING_PAN
    ↓
AWAITING_BANK
    ↓
AWAITING_INCORPORATION
    ↓
AWAITING_AGREEMENT
    ↓
VALIDATING
    ↓
PENDING_APPROVAL
    ↓
WRITING_ERP
    ↓
COMPLETED
```

`FAILED` and `CANCELLED` are terminal states. `PAUSED` is used by the
current rejection flow.

`COMPLETED` is also terminal. Messages received after completion do not
restart the planner or request documents again.

## Onboarding Flow

1.  The vendor opens the Telegram onboarding link and starts the bot.
2.  The bot requests a GST registration certificate.
3.  The GST document is stored and validated.
4.  The bot requests PAN details or a supported PAN document.
5.  PAN format is validated.
6.  The bot requests cancelled-cheque or bank confirmation proof.
7.  IFSC, account number, and available account-holder details are
    validated.
8.  The bot requests company incorporation proof.
9.  The incorporation document is classified and the company name is
    compared with GST evidence.
10. The bot requests the signed Vendor Agreement.
11. The agreement is classified and checked for signed/signature
    evidence.
12. The workflow enters `PENDING_APPROVAL`.
13. A human reviews and decides from the dashboard/API approval flow.
14. On approval, the ERP worker creates or updates the vendor record and
    assigns a vendor code.
15. The workflow reaches `COMPLETED` and Telegram sends the completion
    message.

## Document Validation

Uploaded files are validated before workflow progression.

Supported MIME types:

-   `application/pdf`
-   `image/jpeg`
-   `image/png`
-   `image/webp`

Maximum file size:

``` text
10 MB
```

Document ingestion records metadata including:

-   original filename
-   file size
-   MIME type
-   SHA-256 checksum
-   storage URL
-   Telegram file identifiers
-   validation status
-   extracted fields
-   confidence score
-   document category

The application stores documents in Vercel Blob and keeps references and
metadata in PostgreSQL through Prisma.

## Validation Rules

### GST Certificate

The GST worker requires a real uploaded document. It validates readable
text, GST-certificate indicators, GSTIN extraction, and GSTIN format.

### PAN

PAN values follow:

``` text
AAAAA9999A
```

Example test value:

``` text
ABCDE1234F
```

### Bank Proof

Bank validation expects cancelled-cheque or bank-proof evidence and
validates available banking fields such as account number and IFSC.

IFSC format follows:

``` text
AAAA0XXXXXX
```

### Incorporation Proof

The incorporation worker uses deterministic indicators such as:

-   Certificate of Incorporation
-   Ministry of Corporate Affairs
-   Registrar of Companies
-   Companies Act
-   Corporate Identity Number
-   CIN
-   Date of Incorporation
-   Registered Office

The extracted company name is safely normalized and compared with GST
company-name evidence. Common suffix variants such as `PRIVATE LIMITED`,
`PVT LTD`, and `PVT. LTD.` are normalized without broad fuzzy matching.

### Vendor Agreement

The agreement worker requires a real uploaded document and uses
deterministic agreement indicators. It also checks for signed/signature
evidence such as:

-   SIGNED
-   SIGNATURE
-   AUTHORIZED SIGNATORY
-   AUTHORISED SIGNATORY
-   DIGITALLY SIGNED
-   E-SIGNED
-   ELECTRONICALLY SIGNED
-   `/s/`

An agreement that appears valid but unsigned does not pass validation.

## Human Approval

The Telegram bot cannot approve vendors.

Approval decisions are handled through the dashboard/API approval flow.
While a workflow is in `PENDING_APPROVAL`, normal inbound Telegram
messages do not restart the planner or rerun document workers.

On approval:

``` text
PENDING_APPROVAL → WRITING_ERP → COMPLETED
```

On rejection, the current implementation moves the workflow to `PAUSED`
and sends a non-technical procurement-contact message to the vendor.

## ERP and Vendor Code

The ERP worker is protected by an explicit approval guard. It requires
an `APPROVED` approval record before ERP execution.

Vendor creation is idempotent. Retries reuse the existing vendor code
instead of creating duplicate vendor records or allocating a new code.

The current vendor-code format is deterministic and based on the vendor
identity:

``` text
ABC-VND-<VENDOR_ID_SLICE>
```

Example completion message:

``` text
Vendor onboarding complete. Your vendor code is <VENDOR_CODE>. Welcome aboard.
```

## Architecture

``` text
Telegram
   ↓
Connector Registry
   ↓
Inbound Handler
   ↓
Inbound Idempotency Claim (update_id)
   ↓
runAgentLoop
   ├── Terminal-state guards
   ├── Planner
   ├── Structured Plan Validation
   ├── Worker Dispatch
   ├── WorkerResult
   ├── Technical/Business Validation Gates
   ├── Bounded Replan on Operational Failure
   ├── Prerequisite Guard
   └── Deterministic State Machine
   ↓
Document Workers / Specialized Agents
   ↓
Human Approval
   ↓
ERP Agent
   ↓
COMPLETED
```

*(AgentEvent / Agent Timeline functions as a parallel observability stream tracking the entire lifecycle)*

## Failure Recovery and Replanning

Operations OS supports bounded failure-aware replanning. 
- If a worker fails operationally (e.g., technical exception, network error), it may trigger replanning.
- The failure context is captured in a structured `FailureContext` object, categorized by a failure taxonomy, and redacted for observability.
- A `REPLAN_REQUESTED` event is emitted.
- Replanning is strictly bounded to `MAX_REPLANS = 1` to prevent infinite loops.
- The corrected plan goes through the exact same routing and validation gates.
- **Important:** Business validation failures (e.g., "blurrry document", "mismatched GSTIN") do NOT trigger replanning. They pause the workflow and request correction from the user directly.

## Idempotency

Operations OS enforces strict idempotency for both inbound webhooks and outbound messaging:
- **Inbound Claim:** Incoming Telegram `update_id`s are claimed using a PostgreSQL/Prisma unique constraint.
- **P2002 Suppression:** If a concurrent duplicate webhook arrives, the duplicate is suppressed safely using Prisma's `P2002` error code. The loser always yields.
- **Outbound Semantics:** Outbound messages use stable, semantic idempotency keys (e.g., `outbound:<workflowId>:<executionId>:validation_failed`).
- **Claim Before HTTP:** Outbound claims are recorded in the database *before* making the Telegram HTTP request to prevent race conditions. Same-owner HTTP retries occur naturally after claiming ownership.
- **Limitation:** Abandoned outbound claims (e.g., where the application crashes after claiming but before sending) currently lack a lease-recovery mechanism.

## Agent Timeline and Observability

The Agent Timeline is an append-only stream of `AgentEvent`s tracking the orchestration lifecycle.
- **Event Vocabulary:** Canonical events include `LOOP_STARTED`, `PLAN_CREATED`, `WORKER_DISPATCHED`, `WORKER_RESULT`, `REPLAN_REQUESTED`, `RETRY_SCHEDULED`, `VALIDATION_FAILED`, `VALIDATION_PASSED`, `STATE_TRANSITION`, `EXECUTION_COMPLETED`, and `EXECUTION_FAILED`.
- **Worker Failure:** A worker operational failure is canonically represented by `WORKER_RESULT` with `status='failed'`.
- **Token Usage:** Token usage metadata is persisted whenever supplied by the LLM planner. 
- **Cost:** `estimatedCost` remains explicitly `null` unless a dedicated pricing registry exists; no prices are silently hardcoded or guessed.
- **Observability Redaction:** All sensitive fields (e.g., API keys, PAN numbers, bank details) are scrubbed at the logging boundary using centralized observability redaction to prevent secret leaks, utilizing explicit-key and semantic scrubbing rather than simple long-string heuristics.

## Tech Stack

-   Next.js 16
-   React 19
-   TypeScript
-   Prisma 7
-   PostgreSQL / Neon
-   Vercel Blob
-   Telegram Bot API
-   Tesseract.js
-   pdf-parse
-   Zod
-   Vitest
-   Groq SDK

## Project Structure

``` text
operations-os/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── prompts/
│   └── planner/
│       └── v1.md
├── public/
├── scripts/
├── src/
│   ├── app/
│   │   └── api/
│   └── lib/
│       ├── agents/
│       │   ├── planner.ts
│       │   └── workers/
│       │       ├── gst_agent.ts
│       │       ├── pan_agent.ts
│       │       ├── bank_agent.ts
│       │       ├── incorporation_agent.ts
│       │       ├── agreement_agent.ts
│       │       └── erp_agent.ts
│       ├── connectors/
│       ├── document/
│       │   ├── ingestion.ts
│       │   └── textExtraction.ts
│       ├── storage/
│       ├── validation/
│       │   └── prerequisiteGuard.ts
│       ├── inboundHandler.ts
│       ├── prisma.ts
│       ├── runAgentLoop.ts
│       └── stateMachine.ts
├── AGENTS.md
├── CLAUDE.md
├── DECISIONS.md
├── LIMITATIONS.md
├── package.json
└── README.md
```

## Local Setup

### 1. Clone the repository

``` bash
git clone <YOUR_REPOSITORY_URL>
cd operations-os
```

### 2. Install dependencies

``` bash
npm install
```

### 3. Configure environment variables

Create `.env` from `.env.example`.

``` bash
cp .env.example .env
```

On Windows PowerShell:

``` powershell
Copy-Item .env.example .env
```

Configure the environment variables required by the project. Use
`.env.example` as the source of truth for variable names.

Do not commit `.env` or production secrets.

### 4. Generate Prisma Client

``` bash
npx prisma generate
```

### 5. Synchronize the database for development

``` bash
npx prisma db push
```

Use the project's deployment/database process for production
environments. Do not blindly apply destructive schema changes to
production.

### 6. Run the development server

``` bash
npm run dev
```

Open:

``` text
http://localhost:3000
```

## Verification

Run TypeScript validation:

``` bash
npx tsc --noEmit
```

Run the test suite:

``` bash
npx vitest run
```

Run the production build:

``` bash
npm run build
```

Current verified project baseline:

``` text
253 tests passed
0 tests failed
TypeScript: 0 errors
Production build: successful
```

## Deployment

The application is designed for deployment on Vercel with Neon
PostgreSQL and Vercel Blob.

Before deployment:

1.  Add all required environment variables to the Vercel project.
2.  Confirm `DATABASE_URL` points to the intended Neon database.
3.  Confirm the database schema includes the latest Prisma fields and
    workflow states.
4.  Confirm Vercel Blob credentials/configuration are available.
5.  Configure the Telegram webhook to the deployed application endpoint
    used by this project.
6.  Run `npx tsc --noEmit`.
7.  Run `npx vitest run`.
8.  Run `npm run build`.

## Demo Checklist

Use individual documents for the normal guided happy-path demo.

1.  Start the Telegram onboarding workflow.
2.  Upload a GST certificate PDF or image.
3.  Submit a valid PAN.
4.  Upload cancelled-cheque or bank proof.
5.  Upload incorporation proof with a company name consistent with GST
    evidence.
6.  Upload a signed Vendor Agreement.
7.  Confirm the workflow reaches `PENDING_APPROVAL`.
8.  Approve the vendor from the dashboard.
9.  Confirm vendor-code creation.
10. Confirm the Telegram completion message.
11. Send another Telegram message and verify the completed workflow does
    not restart.

## Current Limitation

A single combined PDF containing GST, PAN, bank proof, incorporation
proof, and the Vendor Agreement is not automatically split into five
logical documents.

The current workflow is designed for guided sequential uploads of
individual onboarding documents.

See `LIMITATIONS.md` for additional documented limitations.

## Design Decisions

Important architectural decisions are documented in `DECISIONS.md`,
including:

-   object-storage abstraction
-   deterministic document validation
-   validation hard gates
-   prerequisite guards
-   company-name consistency
-   signed-agreement validation
-   dashboard-only human approval
-   idempotent ERP creation
-   deterministic vendor-code reuse
-   terminal `COMPLETED` behavior

## Security Notes

-   Uploaded files are restricted by MIME type and size.
-   Filenames are sanitized before storage.
-   SHA-256 checksums are calculated during ingestion.
-   Duplicate workflow documents can be detected by checksum.
-   Document contents are stored in object storage instead of long-lived
    application memory.
-   ERP execution requires explicit approved human-review evidence.
-   Planner output cannot bypass deterministic prerequisite guards.
-   Secrets must remain in environment variables and must never be
    committed.

## License

This project was developed as an assignment/demo implementation. Add the
appropriate license before public or commercial distribution.
