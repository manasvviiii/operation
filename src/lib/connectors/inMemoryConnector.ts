import { Connector, NormalizedOutboundMessage, ConnectorResponse, NormalizedInboundEvent } from './types';

export class InMemoryConnector implements Connector {
  id = 'in-memory';
  kind = 'mock';
  
  public messages: NormalizedOutboundMessage[] = [];

  async sendMessage(input: NormalizedOutboundMessage): Promise<ConnectorResponse> {
    this.messages.push(input);
    return { success: true };
  }

  async handleInbound(input: unknown): Promise<NormalizedInboundEvent | null> {
    return input as NormalizedInboundEvent;
  }
}
