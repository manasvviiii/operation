/**
 * Telegram attachment handling utilities.
 * Extracts metadata from Telegram document and photo messages.
 */

import TelegramBot from 'node-telegram-bot-api';
import { getBot } from './telegram';

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  caption?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  width: number;
  height: number;
}

export interface NormalizedAttachment {
  kind: 'document' | 'photo';
  fileId: string;
  fileUniqueId: string;
  originalFilename?: string;
  mime?: string;
  fileSize?: number;
  caption?: string;
  width?: number;
  height?: number;
}

/**
 * Normalize a Telegram document attachment
 */
export function normalizeDocument(doc: TelegramDocument): NormalizedAttachment {
  return {
    kind: 'document',
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    originalFilename: doc.file_name,
    mime: doc.mime_type,
    fileSize: doc.file_size,
    caption: doc.caption,
  };
}

/**
 * Normalize a Telegram photo attachment
 * Selects the highest-resolution photo
 */
export function normalizePhoto(photos: TelegramPhotoSize[]): NormalizedAttachment | null {
  if (!photos || photos.length === 0) {
    return null;
  }

  // Select the highest-resolution photo (last in array is typically largest)
  const largestPhoto = photos[photos.length - 1];

  return {
    kind: 'photo',
    fileId: largestPhoto.file_id,
    fileUniqueId: largestPhoto.file_unique_id,
    fileSize: largestPhoto.file_size,
    width: largestPhoto.width,
    height: largestPhoto.height,
  };
}

/**
 * Download a file from Telegram using getFile API
 */
export async function downloadTelegramFile(fileId: string): Promise<{
  data: Buffer;
  mime?: string;
}> {
  const bot = getBot();
  
  try {
    const file = await bot.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`No file path returned for file_id: ${fileId}`);
    }

    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    
    // Try to get MIME type from Content-Type header
    const contentType = response.headers.get('content-type') || undefined;

    return { data, mime: contentType };
  } catch (error) {
    throw new Error(`Failed to download Telegram file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract attachment from a Telegram message update
 */
export function extractAttachment(message: any): NormalizedAttachment | null {
  if (message.document) {
    return normalizeDocument(message.document);
  }

  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    return normalizePhoto(message.photo);
  }

  return null;
}
