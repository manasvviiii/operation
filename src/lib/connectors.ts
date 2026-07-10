import TelegramBot from 'node-telegram-bot-api';
import { Connector } from './types';

export class TelegramConnector implements Connector {
  private bot: TelegramBot;
  constructor(token: string) {
    this.bot = new TelegramBot(token);
  }
  async sendMessage(chatId: string, text: string) {
    await this.bot.sendMessage(chatId, text);
  }
}