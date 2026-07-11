/* MOCK: In production this would call a document storage/OCR service (e.g. S3 + Textract) to validate uploaded files against required document types. */
import { WorkerContext, WorkerResult } from './types';

export async function run(context: WorkerContext): Promise<WorkerResult> {
  const latestMessage = context.messages[0];
  const hasDocument = latestMessage?.content.includes('attachment') ?? false;

  if (hasDocument) {
    return { success: true, outboundMessage: "Thanks, we've received your document and it's being reviewed." };
  } else {
    return { success: true, outboundMessage: "Please upload the required document to continue." };
  }
}