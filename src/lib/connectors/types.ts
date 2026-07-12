export interface NormalizedOutboundMessage {
  channelId: string;
  text: string;
  workflowId?: string;
}

export interface NormalizedInboundEvent {
  connectorId: string;
  channelId: string;
  senderId?: string;
  body: string;
  externalMessageId?: string;
  ts: Date;
  workflowId?: string;
}

export interface ConnectorResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface Connector {
  id: string;
  kind: string;
  sendMessage(input: NormalizedOutboundMessage): Promise<ConnectorResponse>;
  handleInbound?(input: unknown): Promise<NormalizedInboundEvent | null>;
  downloadAttachment?(attachmentId: string): Promise<{ data: Buffer; mime: string }>;
}
