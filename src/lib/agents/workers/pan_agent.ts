/* MOCK: In production this would call a PAN verification API (e.g. NSDL/Protean). */
import { WorkerContext, WorkerResult } from './types';

export async function run(context: WorkerContext): Promise<WorkerResult> {
  const latestMessage = context.messages[0];
  if (!latestMessage) {
    return { success: true, outboundMessage: "Please share your PAN number (10-character alphanumeric, e.g. ABCDE1234F)." };
  }

  const panRegex = /\b[A-Za-z]{5}\d{4}[A-Za-z]{1}\b/;
  const match = latestMessage.content.match(panRegex);

  if (match) {
    return { success: true, extractedData: { panNumber: match[0] }, outboundMessage: "PAN number received, verifying..." };
  }

  return { success: true, outboundMessage: "Please share your PAN number (10-character alphanumeric, e.g. ABCDE1234F)." };
}
