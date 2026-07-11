

import { createWorker } from 'tesseract.js';
import { getStorageProvider } from '../storage/vercelBlobProvider';
import type { WorkerDocument } from '../agents/workers/types';

export type TextExtractionMethod =
  | 'PDF_TEXT'
  | 'IMAGE_OCR'
  | 'NONE';

export type TextExtractionFailureReason =
  | 'LOW_READABILITY'
  | 'OCR_REQUIRED'
  | 'UNSUPPORTED_MIME'
  | 'STORAGE_READ_FAILED'
  | 'PDF_EXTRACTION_FAILED'
  | 'OCR_FAILED';

export interface TextExtractionResult {
  text: string;
  readable: boolean;
  method: TextExtractionMethod;
  confidence?: number;
  reason?: TextExtractionFailureReason;
  error?: string;
}

const MIN_READABLE_TEXT_LENGTH = 30;

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasUsableText(text: string): boolean {
  const normalized = normalizeExtractedText(text);

  if (normalized.length < MIN_READABLE_TEXT_LENGTH) {
    return false;
  }

  const alphanumericCharacters = normalized.match(
    /[A-Z0-9]/gi
  );

  return (alphanumericCharacters?.length ?? 0) >= 15;
}

async function extractPdfText(
  fileData: Buffer
): Promise<TextExtractionResult> {
  try {
    const { extractText, getDocumentProxy } =
      await import('unpdf');

    const pdf = await getDocumentProxy(
      new Uint8Array(fileData)
    );

    const result = await extractText(pdf, {
      mergePages: true,
    });

    const rawText = Array.isArray(result.text)
      ? result.text.join('\n')
      : result.text ?? '';

    const text = normalizeExtractedText(rawText);

    if (!hasUsableText(text)) {
      return {
        text,
        readable: false,
        method: 'PDF_TEXT',
        reason: 'OCR_REQUIRED',
        error:
          'The PDF contains little or no readable embedded text.',
      };
    }

    return {
      text,
      readable: true,
      method: 'PDF_TEXT',
      confidence: 1,
    };
  } catch (error) {
    return {
      text: '',
      readable: false,
      method: 'PDF_TEXT',
      reason: 'PDF_EXTRACTION_FAILED',
      error:
        error instanceof Error
          ? error.message
          : 'Unknown PDF text extraction error.',
    };
  }
}

async function extractImageText(
  fileData: Buffer
): Promise<TextExtractionResult> {
  let worker: Awaited<
    ReturnType<typeof createWorker>
  > | null = null;

  try {
    worker = await createWorker('eng');

    const result = await worker.recognize(fileData);

    const text = normalizeExtractedText(
      result.data.text ?? ''
    );

    const rawConfidence = result.data.confidence;

    const confidence =
      typeof rawConfidence === 'number'
        ? Math.max(
            0,
            Math.min(1, rawConfidence / 100)
          )
        : undefined;

    if (!hasUsableText(text)) {
      return {
        text,
        readable: false,
        method: 'IMAGE_OCR',
        confidence,
        reason: 'LOW_READABILITY',
        error:
          'OCR could not extract enough readable text from the image.',
      };
    }

    return {
      text,
      readable: true,
      method: 'IMAGE_OCR',
      confidence,
    };
  } catch (error) {
    return {
      text: '',
      readable: false,
      method: 'IMAGE_OCR',
      reason: 'OCR_FAILED',
      error:
        error instanceof Error
          ? error.message
          : 'Unknown OCR extraction error.',
    };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        console.error(
          '[textExtraction] Failed to terminate OCR worker:',
          error instanceof Error
            ? error.message
            : error
        );
      }
    }
  }
}

export async function extractDocumentText(
  document: WorkerDocument
): Promise<TextExtractionResult> {
  const storageProvider = getStorageProvider();

  let fileData: Buffer;

  try {
    fileData = await storageProvider.get(
      document.storageUrl
    );
  } catch (error) {
    return {
      text: '',
      readable: false,
      method: 'NONE',
      reason: 'STORAGE_READ_FAILED',
      error:
        error instanceof Error
          ? error.message
          : 'Unable to retrieve stored document.',
    };
  }

  if (document.mime === 'application/pdf') {
    return extractPdfText(fileData);
  }

  if (
    document.mime === 'image/jpeg' ||
    document.mime === 'image/png' ||
    document.mime === 'image/webp'
  ) {
    return extractImageText(fileData);
  }

  return {
    text: '',
    readable: false,
    method: 'NONE',
    reason: 'UNSUPPORTED_MIME',
    error: `Unsupported document MIME type: ${document.mime}`,
  };
}