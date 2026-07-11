/**
 * Vercel Blob implementation of StorageProvider.
 * Uses @vercel/blob for serverless-compatible object storage.
 */

import { put, del, head } from '@vercel/blob';
import { StorageProvider } from './storageProvider';

export class VercelBlobStorageProvider implements StorageProvider {
  private readonly allowedMimeTypes: Set<string>;
  private readonly maxFileSizeBytes: number;

  constructor(options: { allowedMimeTypes?: string[]; maxFileSizeBytes?: number } = {}) {
    this.allowedMimeTypes = new Set(
      options.allowedMimeTypes || [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
      ]
    );
    this.maxFileSizeBytes = options.maxFileSizeBytes || 10 * 1024 * 1024; // 10MB default
  }

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string> {
    if (!this.allowedMimeTypes.has(contentType)) {
      throw new Error(`Unsupported MIME type: ${contentType}`);
    }

    if (data.length > this.maxFileSizeBytes) {
      throw new Error(`File size exceeds maximum allowed size of ${this.maxFileSizeBytes} bytes`);
    }

    // Convert Uint8Array to Buffer for compatibility with Vercel Blob
    const buffer = data instanceof Buffer ? data : Buffer.from(data);

    const blob = await put(key, buffer, {
      access: 'public',
      contentType,
    });

    return blob.url;
  }

  async get(key: string): Promise<Buffer> {
    // Vercel Blob doesn't have a direct get method, so we fetch the URL
    const response = await fetch(key);
    if (!response.ok) {
      throw new Error(`Failed to fetch blob: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    await del(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance for the application
let storageProviderInstance: VercelBlobStorageProvider | null = null;

export function getStorageProvider(): VercelBlobStorageProvider {
  if (!storageProviderInstance) {
    storageProviderInstance = new VercelBlobStorageProvider();
  }
  return storageProviderInstance;
}
