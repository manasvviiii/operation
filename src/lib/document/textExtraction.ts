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

function normalizeExtractedText(
  text: string
): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasUsableText(text: string): boolean {
  const normalized = normalizeExtractedText(text);

  if (
    normalized.length < MIN_READABLE_TEXT_LENGTH
  ) {
    return false;
  }

  const alphanumericCharacters = normalized.match(
    /[A-Z0-9]/gi
  );

  return (
    (alphanumericCharacters?.length ?? 0) >= 15
  );
}

async function extractPdfText(
  fileData: Buffer
): Promise<TextExtractionResult> {
  try {
    const {
      extractText,
      getDocumentProxy,
    } = await import('unpdf');

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

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

async function extractImageText(
  fileData: Buffer,
  mime: string
): Promise<TextExtractionResult> {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return {
        text: '',
        readable: false,
        method: 'IMAGE_OCR',
        reason: 'OCR_FAILED',
        error:
          'GROQ_API_KEY is not configured.',
      };
    }

    const base64Image = fileData.toString('base64');

    const imageUrl =
      `data:${mime};base64,${base64Image}`;

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          model:
            process.env.GROQ_VISION_MODEL ||
            'meta-llama/llama-4-scout-17b-16e-instruct',

          temperature: 0,

          max_completion_tokens: 4096,

          messages: [
            {
              role: 'user',

              content: [
                {
                  type: 'text',

                  text:
                    'Perform OCR on this document image. ' +
                    'Return only the visible document text. ' +
                    'Preserve important identifiers, registration numbers, ' +
                    'company names, account numbers, labels, dates, and signatures. ' +
                    'Do not explain the image. Do not summarize it. ' +
                    'Do not add markdown formatting.',
                },

                {
                  type: 'image_url',

                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    const result =
      (await response.json()) as GroqChatCompletionResponse;

    if (!response.ok) {
      const apiError =
        result.error?.message ||
        `Groq OCR request failed with HTTP ${response.status}`;

      console.error(
        '[textExtraction] Groq vision failed:',
        apiError
      );

      return {
        text: '',
        readable: false,
        method: 'IMAGE_OCR',
        reason: 'OCR_FAILED',
        error: apiError,
      };
    }

    const rawText =
      result.choices?.[0]?.message?.content ?? '';

    const text = normalizeExtractedText(rawText);

    console.log(
      '[textExtraction] Groq vision extracted text length:',
      text.length
    );

    if (!hasUsableText(text)) {
      return {
        text,
        readable: false,
        method: 'IMAGE_OCR',
        confidence: 0,
        reason: 'LOW_READABILITY',
        error:
          'Vision OCR could not extract enough readable text from the image.',
      };
    }

    return {
      text,
      readable: true,
      method: 'IMAGE_OCR',
      confidence: 1,
    };
  } catch (error) {
    console.error(
      '[textExtraction] Image OCR failed:',
      error instanceof Error
        ? error.message
        : error
    );

    return {
      text: '',
      readable: false,
      method: 'IMAGE_OCR',
      reason: 'OCR_FAILED',
      error:
        error instanceof Error
          ? error.message
          : 'Unknown image OCR error.',
    };
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

  console.log(
    '[textExtraction] Extracting document:',
    {
      id: document.id,
      mime: document.mime,
      size: fileData.length,
    }
  );

  if (document.mime === 'application/pdf') {
    return extractPdfText(fileData);
  }

  if (
    document.mime === 'image/jpeg' ||
    document.mime === 'image/png' ||
    document.mime === 'image/webp'
  ) {
    return extractImageText(
      fileData,
      document.mime
    );
  }

  return {
    text: '',
    readable: false,
    method: 'NONE',
    reason: 'UNSUPPORTED_MIME',
    error:
      `Unsupported document MIME type: ${document.mime}`,
  };
}