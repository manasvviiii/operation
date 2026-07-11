import { prisma } from '../../prisma';
import { WorkerContext, WorkerResult } from './types';
import { ErpConnector } from '../../connectors/erpConnector';

export async function run(
  context: WorkerContext
): Promise<WorkerResult> {
  const approval = await prisma.approval.findFirst({
    where: {
      workflowId: context.workflowId,
      decision: 'APPROVED',
    },
  });

  if (!approval) {
    return {
      success: false,
      validationPassed: false,
      retryable: false,
      error: 'Cannot execute ERP write without an APPROVED human decision.',
    };
  }

  let vendor = await prisma.vendor.findUnique({
    where: { id: context.vendor.id },
  });

  if (!vendor) {
    return {
      success: false,
      validationPassed: false,
      error: 'Vendor not found.',
      retryable: true,
    };
  }

  let vendorCode = vendor.vendorCode;
  if (!vendorCode) {
    vendorCode = `ABC-VND-${vendor.id.substring(0, 8).toUpperCase()}`;
    vendor = await prisma.vendor.update({
      where: { id: vendor.id },
      data: { vendorCode },
    });
  }

  const connector = new ErpConnector();

  try {
    const response = await connector.execute({
      operation: 'createVendorRecord',
      payload: {
        workflowId: context.workflowId,
        vendorId: context.vendor.id,
        vendorCode,
        extractedFields: context.extractedFields,
      },
      idempotencyKey: `erp-write-${context.workflowId}`,
    });

    if (!response.success) {
      return {
        success: false,
        validationPassed: false,
        retryable: true,
        error: response.error ?? 'ERP vendor creation failed.',
      };
    }
    
    await prisma.vendor.update({
      where: { id: context.vendor.id },
      data: { status: 'ACTIVE' },
    });

    return {
      success: true,
      validationPassed: true,
      retryable: false,
      extractedData: { vendorCode },
      outboundMessage: `Vendor onboarding complete. Your vendor code is ${vendorCode}. Welcome aboard.`,
    };
  } catch (error) {
    return {
      success: false,
      validationPassed: false,
      retryable: true,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown ERP connector error.',
    };
  }
}