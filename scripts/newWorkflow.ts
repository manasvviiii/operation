import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Optional: pass a vendor name as a CLI arg, e.g. `npx tsx scripts/newWorkflow.ts "Globex Inc"`
  const vendorName = process.argv[2] || 'Demo Vendor Pvt Ltd';

  const vendor = await prisma.vendor.create({
    data: {
      legalName: vendorName,
      contactEmail: `contact@${vendorName.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`,
      status: 'PROSPECT',
    },
  });

  const workflow = await prisma.workflow.create({
    data: {
      vendorId: vendor.id,
      state: 'INITIATED',
      currentStep: 'Waiting for vendor to start',
      primaryChannel: 'telegram',
    },
  });

  console.log(`\n✅ New vendor + workflow created!`);
  console.log(`Vendor: ${vendor.legalName} (${vendor.id})`);
  console.log(`Workflow ID: ${workflow.id}\n`);
  console.log(`🚀 TAP THIS LINK IN TELEGRAM TO START ONBOARDING:`);
  console.log(`https://t.me/YOUR_BOT_USERNAME?start=${workflow.id}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });