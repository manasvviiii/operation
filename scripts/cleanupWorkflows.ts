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

const ORPHANED_IDS = [
  'cmrepn5rv0001m0l9sck5d545',
  'cmrepnmkv0001z0l9olvoqcdk',
  '469b5e49-283d-4f3e-b3f6-29e9621602dd',
  '9706d230-63b3-43ad-9d66-c2a6f0b3df66'
];

async function main() {
  console.log(`Starting cleanup of ${ORPHANED_IDS.length} orphaned workflows...`);

  for (const id of ORPHANED_IDS) {
    // Check if workflow exists
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) {
      console.log(`Workflow ${id} not found in DB, skipping...`);
      continue;
    }

    console.log(`Cleaning workflow ${id}...`);

    // Get execution IDs to clean up agentRuns
    const executions = await prisma.execution.findMany({
      where: { workflowId: id },
      select: { id: true }
    });
    const execIds = executions.map(e => e.id);

    if (execIds.length > 0) {
      const runsResult = await prisma.agentRun.deleteMany({
        where: { executionId: { in: execIds } }
      });
      console.log(`  Deleted ${runsResult.count} agentRun rows.`);
    }

    const execResult = await prisma.execution.deleteMany({
      where: { workflowId: id }
    });
    console.log(`  Deleted ${execResult.count} execution rows.`);

    const msgResult = await prisma.message.deleteMany({
      where: { workflowId: id }
    });
    console.log(`  Deleted ${msgResult.count} message rows.`);

    const approvalResult = await prisma.approval.deleteMany({
      where: { workflowId: id }
    });
    console.log(`  Deleted ${approvalResult.count} approval rows.`);

    const docResult = await prisma.document.deleteMany({
      where: { workflowId: id }
    });
    console.log(`  Deleted ${docResult.count} document rows.`);

    const auditResult = await prisma.auditLog.deleteMany({
      where: { workflowId: id }
    });
    console.log(`  Deleted ${auditResult.count} auditLog rows.`);

    await prisma.workflow.delete({
      where: { id }
    });
    console.log(`  Deleted workflow ${id}.`);
  }

  console.log('Cleanup completed successfully!');
}

main()
  .catch((err) => {
    console.error('Error cleaning up workflows:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
