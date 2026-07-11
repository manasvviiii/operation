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
    createdAt: Date;
  }>;
  plan: {
    nextWorker: string;
    targetState: string;
    reasoningSummary: string;
  };
}

export interface WorkerResult {
  success: boolean;
  outboundMessage?: string;
  extractedData?: Record<string, unknown>;
  error?: string;
}
