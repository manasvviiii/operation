# Known Limitations — Operations OS

This document lists confirmed, source-verified limitations at the current HEAD.

---

## Database Field Encryption

While a centralized observability redaction boundary scrubs PAN, GSTIN, bank
accounts, and secrets from all orchestration logs, console outputs, and the
Agent Timeline, this only protects data at the logging/observability layer.

**Limitation:** The system does NOT implement column-level or application-level
field encryption for sensitive fields persisted in the main database models:

- `Workflow.extractedFields`
- `Document.extractedText`
- User messages saved in the `Message` table

These are all stored as plaintext in PostgreSQL. Future implementation phases
must introduce KMS integration and AES-256-GCM application-level encryption
before the database layer.

---

## ERP Connector is Not a Real Enterprise ERP Integration

The `erp_agent` creates an internal database record (vendor code assignment)
and calls the `ErpConnector.createVendorRecord()` method. This simulates an ERP
write but does not connect to any real enterprise ERP system (SAP, Oracle, etc.)
or expose a real integration API.

---

## No Live Government GST/PAN Verification APIs

Validation of GSTIN and PAN values uses deterministic regex and indicator-based
heuristics applied to uploaded document text. The system does **not** call any
live government portal or third-party verification API (e.g., GSTN REST API,
PAN verification, penny-drop bank verification). An uploaded document with a
syntactically valid GSTIN that is not actually registered will pass validation.

---

## PAUSED Workflows Require Manual Follow-Up

`PAUSED` is used for rejected approval workflows. The state machine allows
transitions from `PAUSED` only to `FAILED` or `CANCELLED`. There is no
automated resubmission path. A rejected vendor requires manual, out-of-band
intervention to restart onboarding.

---

## Abandoned Outbound Idempotency Claims Have No Lease Recovery

When the `TelegramConnector` sends an outbound message, it first creates a
`Message` claim with a stable idempotency key. If the process crashes or times
out after claiming but before the Telegram HTTP request completes, the claim
record will remain in the database without an `externalMessageId`. There is no
automatic lease expiry or recovery mechanism. A human operator must manually
clear the stale claim row to allow the message to be retried.

---

## Bounded Replan Budget is Loop-Local Only

`MAX_REPLANS = 1` is enforced locally within a single `runAgentLoop` invocation.
If a failed workflow is re-triggered by a new inbound Telegram webhook (starting
a fresh `runAgentLoop` call), the replan counter resets to zero. There is no
global, workflow-persistent replan budget tracked in the database.

---

## Combined Document Uploads Are Not Auto-Split

A single combined PDF containing GST, PAN, bank proof, incorporation proof,
and the Vendor Agreement cannot be automatically split into five logical
documents. The workflow is designed for guided sequential individual document
uploads.