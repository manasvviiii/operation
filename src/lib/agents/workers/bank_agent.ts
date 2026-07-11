/* MOCK: In production this would call a bank account verification service (penny-drop API). */
import { WorkerContext, WorkerResult } from './types';

export async function run(context: WorkerContext): Promise<WorkerResult> {
  const latestMessage = context.messages[0];
  if (!latestMessage) {
    return { success: true, outboundMessage: "Please share your bank details including IFSC code." };
  }

  const ifscRegex = /\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/;
  const match = latestMessage.content.match(ifscRegex);

  if (match) {
    return { success: true, extractedData: { ifsc: match[0] }, outboundMessage: "Bank details received, verifying..." };
  }

  return { success: true, outboundMessage: "Please share your bank details including IFSC code." };
}
