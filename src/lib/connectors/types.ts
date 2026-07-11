export interface ConnectorRequest {
  operation: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ConnectorResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface Connector {
  name: string;
  execute(request: ConnectorRequest): Promise<ConnectorResponse>;
}
