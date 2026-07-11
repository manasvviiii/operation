import { prisma } from './prisma';
import { normalizeUpdate } from './connectors/telegram';
import { TelegramConnector } from './connectors/telegramConnector';
import { runAgentLoop } from './runAgentLoop';

const telegramConnector = new TelegramConnector();

export async function handleInboundUpdate(rawUpdate: any): Promise<void> {
  const inbound = normalizeUpdate(rawUpdate);
  if (!inbound) {
    return;
  }

  const { chatId, senderId, body, externalMessageId, ts, workflowId } = inbound;

  let workflow;

  if (workflowId) {
    workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });

    if (!workflow) {
      console.warn(`[inbound] Unknown workflowId from /start link: ${workflowId}`);
      return;
    }

    if (!workflow.chatId) {
      workflow = await prisma.workflow.update({
        where: { id: workflow.id },
        data: { chatId },
      });
    }
  } else {
    workflow = await prisma.workflow.findFirst({
      where: { chatId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!workflow) {
      await telegramConnector.execute({ operation: 'sendMessage', payload: { chatId, text: "I don't recognize this chat — please use your onboarding link to start." } });
      return;
    }
  }

  try {
    await prisma.message.create({
      data: {
        workflowId: workflow.id,
        connectorId: 'telegram',
        direction: 'INBOUND',
        role: 'user',
        channel: 'telegram',
        senderId,
        content: body,
        externalMessageId,
        createdAt: ts,
      },
    });

    await runAgentLoop(workflow.id, 'inbound_message');
  } catch (error) {
    console.error(
      `[inbound] Failed to process message for workflow ${workflow.id}:`,
      error instanceof Error ? error.message : error
    );
  }
}