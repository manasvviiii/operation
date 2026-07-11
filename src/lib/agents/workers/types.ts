export interface WorkerMessageAttachment {
  kind: 'document' | 'photo';
  fileId: string;
  fileUniqueId: string;
  originalFilename?: string;
  mime?: string;
  fileSize?: number;
  caption?: string;
  width?: number;
  height?: number;
  documentId?: string | null;
}

export interface WorkerDocument {
  id: string;
  type: string;
  category?: string | null;
  originalFilename: string;
  fileSize: number;
  mime: string;
  storageUrl: string;
  validationStatus: string;
  verified: boolean;
  extractedFields?: unknown;
  confidence?: number | null;
}

export interface WorkerContext {
  workflowId: string;

  vendor: {
    id: string;
    legalName: string;
    contactEmail: string | null;
    status: string;
  };

  messages: Array<{
    id: string;
    role: string;
    content: string;
    attachments?: WorkerMessageAttachment | null;
    createdAt: Date;
  }>;

  documents: WorkerDocument[];

  plan: {
    nextWorker: string;
    targetState: string;
    reasoningSummary: string;
  };

  extractedFields?: Record<string, unknown>;
}

export interface WorkerResult {
  /**
   * Technical execution status.
   *
   * true  = worker executed normally
   * false = worker crashed or encountered a technical failure
   */
  success: boolean;

  /**
   * Business validation result.
   *
   * true  = the onboarding requirement for this worker is satisfied
   * false = user input/document is invalid or incomplete
   */
  validationPassed: boolean;

  /**
   * Message sent back to the vendor through Telegram.
   */
  outboundMessage?: string;

  /**
   * Validated structured data extracted by the worker.
   */
  extractedData?: Record<string, unknown>;

  /**
   * Confidence from 0 to 1 when document extraction or
   * classification is involved.
   */
  confidence?: number;

  /**
   * Indicates whether the operation may safely be retried.
   */
  retryable?: boolean;

  /**
   * Technical or validation error description.
   */
  error?: string;
}