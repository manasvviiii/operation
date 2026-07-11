/* MOCK: In production this would call a real ERP system's API (SAP, NetSuite, Oracle) to create a vendor master record. This class proves the Connector interface is swappable — a real implementation would only need to change execute()'s internals, not the interface or any calling code. */
import { Connector, ConnectorRequest, ConnectorResponse } from './types';
import { withRetry, withIdempotency, hasIdempotencyKey } from '../retry';

const MOCK_FAILURE_RATE = 0.15;

export class ErpConnector implements Connector {
  name = 'erp';

  async execute(request: ConnectorRequest): Promise<ConnectorResponse> {
    if (request.operation === 'createVendorRecord') {
      const { workflowId } = request.payload as { workflowId: string; vendorId: string };
      const idempotencyKey = request.idempotencyKey ?? `erp-${workflowId}`;

      if (hasIdempotencyKey(idempotencyKey)) {
        console.warn(`[erp_connector] Idempotent no-op: ERP write already completed for key ${idempotencyKey}`);
      }

      try {
        const result = await withIdempotency(idempotencyKey, () => 
          withRetry(async () => {
            // Simulated ERP API call with transient failure rate
            if (Math.random() < MOCK_FAILURE_RATE) {
              throw new Error('ERP_TIMEOUT');
            }
            const fakeRecordId = `erp-record-${Date.now()}`;
            return fakeRecordId;
          })
        );
        return { success: true, data: { recordId: result } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return { success: false, error: `Unsupported operation: ${request.operation}` };
  }
}
