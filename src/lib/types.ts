export interface Connector {
  sendMessage(chatId: string, text: string): Promise<void>;
}