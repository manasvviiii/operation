// src/lib/inboundHandler.ts
import { prisma } from './prisma';
import { runAgentLoop } from './orchestra';

export async function handleInbound(channel: string, payload: any) {
  const chatId = payload.message.chat.id.toString();
  const text = payload.message.text;

  // 1. Audit Trail: Save to Postgres
  // You'll need to resolve the workflowId based on the chatId
  const workflow = await prisma.workflow.findFirst({
    where: { vendor: { contactEmail: { contains: chatId } } } 
  });

  if (!workflow) {
    console.error(`[Inbound] No workflow found for chat ${chatId}`);
    return;
  }

  await prisma.message.create({
    data: {
      workflowId: workflow.id,
      body: text,
      direction: 'INBOUND',
      channel: channel,
    },
  });

  // 2. Wake up the brain!
  console.log(`[Inbound] Message received. Triggering orchestrator for workflow ${workflow.id}`);
  await runAgentLoop(workflow.id);
}