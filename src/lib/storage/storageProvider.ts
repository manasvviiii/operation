/**
 * Storage provider abstraction for document storage.
 * This allows switching between different storage backends (Vercel Blob, S3, etc.)
 * without changing the document ingestion logic.
 */

export interface StorageProvider {
  /**
   * Store a file and return its storage key/URL
   * @param key - The storage key (path) for the file
   * @param data - The file data as a Buffer or Uint8Array
   * @param contentType - The MIME type of the file
   * @returns The storage URL or key
   */
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string>;

  /**
   * Retrieve a file by its storage key/URL
   * @param key - The storage key or URL
   * @returns The file data as a Buffer
   */
  get(key: string): Promise<Buffer>;

  /**
   * Delete a file by its storage key/URL
   * @param key - The storage key or URL
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists
   * @param key - The storage key or URL
   * @returns true if the file exists
   */
  exists(key: string): Promise<boolean>;
}
