import { prisma } from '@/lib/prisma'; // Make sure your prisma.ts file is set up to export the client

export async function handleInbound(channel: string, payload: any, workflowId: string) {
  const chatId = payload.message.chat.id.toString();
  const text = payload.message.text;

  // Audit Log: Store the message in Neon before doing anything else
  await prisma.message.create({
    data: {
      workflowId,
      content: text,
      direction: 'INBOUND',
      channel: channel,
      senderId: chatId,
    },
  });

  console.log(`[${channel}] Message saved for chat ${chatId}: ${text}`);
}