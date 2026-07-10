import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { handleInboundUpdate } from '../src/lib/inboundHandler';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
}

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (message) => {
  handleInboundUpdate({ message }).catch((error) => {
    console.error('[dev-poll] Error handling message:', error);
  });
});

console.log('Polling started. Send /start <workflow-id> to your bot to test.');
