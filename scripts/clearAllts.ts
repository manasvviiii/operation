import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Delete in FK-safe order: children before parents
  await prisma.agentRun.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.message.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.vendor.deleteMany();

  console.log('✅ All workflow data cleared. Database is empty and ready for a fresh demo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });