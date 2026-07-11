/**
 * Document ingestion service.
 * Handles file validation, storage, and database persistence.
 */

import crypto from 'crypto';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getStorageProvider } from '../storage/vercelBlobProvider';

export interface DocumentMetadata {
  workflowId: string;
  type: string;
  category?: string;
  originalFilename: string;
  fileSize: number;
  mime: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface IngestedDocument {
  id: string;
  storageUrl: string;
  checksum: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Sanitize a filename to prevent path traversal and unsafe characters.
 */
function sanitizeFilename(filename: string): string {
  const baseName = path.basename(filename);

  const sanitized = baseName.replace(
    /[\x00-\x1f\x80-\x9f]/g,
    ''
  );

  return sanitized.slice(0, 255);
}

/**
 * Calculate SHA-256 checksum.
 */
export function calculateChecksum(data: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

/**
 * Validate MIME type.
 */
export function validateMimeType(mime: string): boolean {
  return ALLOWED_MIME_TYPES.has(mime);
}

/**
 * Validate file size.
 */
export function validateFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE_BYTES;
}

/**
 * Generate a unique object-storage key.
 */
function generateStorageKey(
  workflowId: string,
  originalFilename: string
): string {
  const timestamp = Date.now();
  const random = Math.random()
    .toString(36)
    .substring(2, 10);

  const ext = path.extname(originalFilename);

  const baseName = path
    .basename(originalFilename, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '');

  return `documents/${workflowId}/${timestamp}-${random}-${baseName}${ext}`;
}

/**
 * Validate, store and persist a document.
 */
export async function ingestDocument(
  fileData: Buffer,
  metadata: DocumentMetadata
): Promise<IngestedDocument> {
  if (!validateMimeType(metadata.mime)) {
    throw new Error(
      `Unsupported MIME type: ${metadata.mime}`
    );
  }

  if (!validateFileSize(metadata.fileSize)) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes`
    );
  }

  const sanitizedFilename = sanitizeFilename(
    metadata.originalFilename
  );

  const checksum = calculateChecksum(fileData);

  const existingDocument = await prisma.document.findFirst({
    where: {
      workflowId: metadata.workflowId,
      checksum,
    },
  });

  if (existingDocument) {
    return {
      id: existingDocument.id,
      storageUrl: existingDocument.storageUrl,
      checksum: existingDocument.checksum,
    };
  }

  const storageKey = generateStorageKey(
    metadata.workflowId,
    sanitizedFilename
  );

  const storageProvider = getStorageProvider();

  const storageUrl = await storageProvider.put(
    storageKey,
    fileData,
    metadata.mime
  );

  const document = await prisma.document.create({
    data: {
      workflowId: metadata.workflowId,
      type: metadata.type,
      category: metadata.category,
      originalFilename: sanitizedFilename,
      fileSize: metadata.fileSize,
      mime: metadata.mime,
      checksum,
      storageUrl,
      telegramFileId: metadata.telegramFileId,
      telegramFileUniqueId:
        metadata.telegramFileUniqueId,
      validationStatus: 'pending',
      verified: false,
    },
  });

  return {
    id: document.id,
    storageUrl: document.storageUrl,
    checksum: document.checksum,
  };
}

/**
 * Get workflow documents.
 */
export async function getWorkflowDocuments(
  workflowId: string,
  category?: string
) {
  const where: Prisma.DocumentWhereInput = {
    workflowId,
  };

  if (category) {
    where.category = category;
  }

  return prisma.document.findMany({
    where,
    orderBy: {
      uploadedAt: 'desc',
    },
  });
}

/**
 * Update document validation result.
 */
export async function updateDocumentValidation(
  documentId: string,
  status: 'pending' | 'passed' | 'failed',
  extractedFields?: Record<string, unknown>,
  confidence?: number,
  error?: string,
  category?: string
) {
  return prisma.document.update({
    where: {
      id: documentId,
    },

    data: {
      validationStatus: status,
      verified: status === 'passed',

      category,

      extractedFields: extractedFields
        ? (extractedFields as Prisma.InputJsonValue)
        : undefined,

      confidence,

      validationError: error,
    },
  });
}