import { WorkerContext, WorkerResult } from './types';
import { ErpConnector } from '../../connectors/erpConnector';

export async function run(context: WorkerContext): Promise<WorkerResult> {
  const connector = new ErpConnector();
  
  const response = await connector.execute({
    operation: 'createVendorRecord',
    payload: { 
      workflowId: context.workflowId, 
      vendorId: context.vendor.id,
      extractedFields: context.extractedFields
    },
    idempotencyKey: `erp-write-${context.workflowId}`
  });

  return {
    success: response.success,
    outboundMessage: response.success ? 'Vendor onboarding complete — your record has been created in our system.' : undefined,
    error: response.error
  };
}
