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
  const workflows = await prisma.workflow.findMany({
    include: {
      vendor: true,
      _count: {
        select: {
          messages: true,
          auditLogs: true,
          approvals: true,
        }
      }
    }
  });

  console.log('Workflows in DB:');
  workflows.forEach(w => {
    console.log(`ID: ${w.id} | Vendor: ${w.vendor.legalName} | State: ${w.state} | ChatId: ${w.chatId} | Messages: ${w._count.messages} | AuditLogs: ${w._count.auditLogs}`);
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
