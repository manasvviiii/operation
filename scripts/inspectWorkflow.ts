import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const workflowId = "6a38bf3f-5818-4414-843d-85174fc9a389";

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
  });

  const docs = await prisma.document.findMany({
    where: { workflowId },
    orderBy: { uploadedAt: "desc" },
  });

  console.log("\n=== WORKFLOW ===");
  console.log(JSON.stringify(workflow, null, 2));

  console.log("\n=== DOCUMENTS ===");
  console.log(JSON.stringify(docs, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
