import { Connector, ConnectorRequest, ConnectorResponse } from './types';
import { sendMessage } from './telegram';

export class TelegramConnector implements Connector {
  name = 'telegram';

  async execute(request: ConnectorRequest): Promise<ConnectorResponse> {
    if (request.operation === 'sendMessage') {
      try {
        const { chatId, text } = request.payload as { chatId: string; text: string };
        await sendMessage(chatId, text);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return { success: false, error: `Unsupported operation: ${request.operation}` };
  }
}
