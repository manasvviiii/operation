import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL not set');
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('--- STARTING APPROVAL API MANUAL TEST ---');

  // 1. Create a temporary vendor
  const vendor = await prisma.vendor.create({
    data: {
      legalName: 'Test Approval Vendor Corp',
      taxId: 'TEST-TAX-999',
      contactEmail: 'test-operator-decide@example.com',
      status: 'PROSPECT',
    }
  });

  // 2. Create a temporary workflow in PENDING_APPROVAL
  const workflow = await prisma.workflow.create({
    data: {
      vendorId: vendor.id,
      state: 'PENDING_APPROVAL',
      currentStep: 'Verify Bank Details',
      primaryChannel: 'telegram',
    }
  });

  // 3. Create a pending approval row
  const approval = await prisma.approval.create({
    data: {
      workflowId: workflow.id,
      step: 'Verify Bank Details',
      decision: 'PENDING',
    }
  });

  console.log('\n[BEFORE] Database State:');
  console.log(`Workflow ID: ${workflow.id}`);
  console.log(`Workflow State: ${workflow.state}`);
  console.log(`Approval ID: ${approval.id}`);
  console.log(`Approval Decision: ${approval.decision}`);

  // 4. Send POST request to the API
  const url = `http://localhost:3001/api/approvals/${approval.id}/decide`;
  console.log(`\nSending POST to ${url}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'APPROVED',
        decidedBy: 'test-operator-cli',
        reason: 'Verification test passed!'
      })
    });

    const body = await response.json();
    console.log(`API Response (Status ${response.status}):`, JSON.stringify(body, null, 2));

    if (!response.ok) {
      throw new Error(`API returned error: ${body.error}`);
    }

    // 5. Query updated state
    const updatedWorkflow = await prisma.workflow.findUnique({
      where: { id: workflow.id }
    });

    const updatedApproval = await prisma.approval.findUnique({
      where: { id: approval.id }
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { workflowId: workflow.id }
    });

    console.log('\n[AFTER] Database State:');
    console.log(`Workflow State: ${updatedWorkflow?.state} (Expected: WRITING_ERP)`);
    console.log(`Approval Decision: ${updatedApproval?.decision} (Expected: APPROVED)`);
    console.log(`Approval DecidedBy: ${updatedApproval?.decidedBy} (Expected: test-operator-cli)`);
    console.log(`AuditLogs Created: ${auditLogs.length}`);
    if (auditLogs.length > 0) {
      console.log('Last AuditLog Record:', JSON.stringify(auditLogs[auditLogs.length - 1], null, 2));
    }
  } catch (error) {
    console.error('Test execution failed:', error);
  } finally {
    // 6. Clean up database
    console.log('\nCleaning up test records...');
    await prisma.approval.deleteMany({ where: { workflowId: workflow.id } });
    await prisma.auditLog.deleteMany({ where: { workflowId: workflow.id } });
    await prisma.workflow.delete({ where: { id: workflow.id } });
    await prisma.vendor.delete({ where: { id: vendor.id } });
    console.log('Cleanup complete!');
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
