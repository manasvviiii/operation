# Security Limitations

## Database Field Encryption

While we have implemented a centralized observability redaction boundary that aggressively scrubs PAN, GSTIN, bank accounts, and secrets from all orchestration logs, console outputs, and the Agent Timeline, this only protects data in flight and in logging systems. 

**Limitation**: The system currently does **NOT** implement column-level or application-level field encryption for sensitive fields persisted in the main database models.

This means that:
- `Workflow.extractedFields`
- `Document.extractedText` 
- User messages saved in the `Message` table

Are all stored as plaintext within the PostgreSQL database. This remains a known security risk and violates zero-trust persistence requirements for PII and financial identifiers. Future implementation phases must introduce KMS integration and AES-256-GCM application-level encryption for these fields before the database layer.