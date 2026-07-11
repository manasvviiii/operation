import {
  WorkerContext,
  WorkerResult,
} from './types';

export async function run(
  context: WorkerContext
): Promise<WorkerResult> {
  const latestDocument = [...context.documents]
    .reverse()
    .find((document) => document.storageUrl);

  if (!latestDocument) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'Please upload the required document as a PDF or clear image to continue.',
      retryable: true,
    };
  }

  if (
    latestDocument.validationStatus === 'failed'
  ) {
    return {
      success: true,
      validationPassed: false,
      outboundMessage:
        'I received the document, but it did not pass validation. Please upload a clear and valid copy of the required document.',
      confidence:
        latestDocument.confidence ?? undefined,
      retryable: true,
    };
  }

  if (
    latestDocument.validationStatus === 'passed' &&
    latestDocument.verified
  ) {
    return {
      success: true,
      validationPassed: true,
      outboundMessage:
        "Thanks, we've received and validated your document.",
      confidence:
        latestDocument.confidence ?? undefined,
      retryable: false,
    };
  }

  return {
    success: true,
    validationPassed: false,
    outboundMessage:
      "Thanks, we've received your document. It still needs to be validated before onboarding can continue.",
    confidence:
      latestDocument.confidence ?? undefined,
    retryable: true,
  };
}