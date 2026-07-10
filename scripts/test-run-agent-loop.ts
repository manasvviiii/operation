import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { runAgentLoop } from '../src/lib/runAgentLoop';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get the workflow ID from command line args or use a default
  const workflowId = process.argv[2];

  if (!workflowId) {
    console.error('Usage: npx ts-node scripts/test-run-agent-loop.ts <workflow-id>');
    console.error('You can find the workflow ID by running: npx prisma db seed');
    process.exit(1);
  }

  console.log(`\n🚀 Running agent loop for workflow: ${workflowId}`);

  try {
    await runAgentLoop(workflowId, 'test_script');
    console.log('✅ Agent loop completed successfully');
  } catch (error) {
    console.error('❌ Agent loop failed:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
