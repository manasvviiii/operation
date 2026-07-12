import { prisma } from "../src/lib/prisma";
import { redactForObservability } from "../src/lib/observability/redaction";

async function main() {
 const workflowId = "73c29feb-f5fd-46f7-8fc1-18408d8d7b8f";

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
  });

  const docs = await prisma.document.findMany({
    where: { workflowId },
    orderBy: { uploadedAt: "desc" },
  });

  console.log("\n=== WORKFLOW ===");
  console.log(JSON.stringify(redactForObservability(workflow), null, 2));

  console.log("\n=== DOCUMENTS ===");
  console.log(JSON.stringify(redactForObservability(docs), null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
