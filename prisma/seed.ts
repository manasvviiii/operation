import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const vendorId = '00000000-0000-0000-0000-000000000001';
  const workflowId = '00000000-0000-0000-0000-000000000002';

  const vendor = await prisma.vendor.upsert({
    where: { id: vendorId },
    update: {
      legalName: 'Acme Corp Pvt Ltd',
      contactEmail: 'contact@acmecorp.example.com',
      status: 'PROSPECT',
    },
    create: {
      id: vendorId,
      legalName: 'Acme Corp Pvt Ltd',
      contactEmail: 'contact@acmecorp.example.com',
      status: 'PROSPECT',
    },
  })

  const workflow = await prisma.workflow.upsert({
    where: { id: workflowId },
    update: {
      vendorId: vendor.id,
      state: 'INITIATED',
      currentStep: 'Waiting for vendor to start',
      primaryChannel: 'telegram',
    },
    create: {
      id: workflowId,
      vendorId: vendor.id,
      state: 'INITIATED',
      currentStep: 'Waiting for vendor to start',
      primaryChannel: 'telegram',
    },
  })

  console.log(`\n✅ Database Seeded Successfully!`)
  console.log(`Vendor Created/Updated: ${vendor.legalName} (${vendor.id})`)
  console.log(`Workflow ID: ${workflow.id}\n`)
  console.log(`🚀 TAP THIS LINK IN TELEGRAM TO START ONBOARDING:`)
  console.log(`https://t.me/YOUR_BOT_USERNAME?start=${workflow.id}\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })