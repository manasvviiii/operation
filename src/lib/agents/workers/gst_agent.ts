/* MOCK: In production this would call the GST government portal's verification API. */
import { WorkerContext, WorkerResult } from './types';

export async function run(context: WorkerContext): Promise<WorkerResult> {
  const latestMessage = context.messages[0];
  if (!latestMessage) {
    return { success: true, outboundMessage: "Please share your GST number (15-character alphanumeric)." };
  }

  const gstRegex = /\b[A-Za-z0-9]{15}\b/;
  const match = latestMessage.content.match(gstRegex);

  if (match) {
    return { success: true, extractedData: { gstNumber: match[0] }, outboundMessage: "GST number received, verifying..." };
  }

  return { success: true, outboundMessage: "Please share your GST number (15-character alphanumeric)." };
}
