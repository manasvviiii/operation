import { prisma } from './prisma';
import { PlanContext } from './prompts/planner';
export async function getWorkflowData(id: string) {
  return await prisma.workflow.findUnique({
    where: { id },
    // include your relations here if needed
  });
}

export async function getFullContext(workflowId: string): Promise<PlanContext | null> {
  const data = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: { 
      vendor: true, 
      messages: true, 
      auditLogs: true 
    }
  });

  if (!data) return null;

  // This structure matches PlanContext exactly
  return {
    workflow: {
      id: data.id,
      state: data.state,
      currentStep: data.currentStep || 'INITIATED',
      vendorId: data.vendorId,
    },
    vendor: {
      id: data.vendor.id,
      legalName: data.vendor.legalName,
      contactEmail: data.vendor.contactEmail,
      status: data.vendor.status,
    },
    messages: data.messages,
    auditLogs: data.auditLogs,
  };
}