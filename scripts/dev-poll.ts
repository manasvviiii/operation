import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { handleInboundUpdate } from '../src/lib/inboundHandler';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
}

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (message) => {
  console.log('[dev-poll] Received message:', message.chat.id, message.text ?? '(non-text)');
  handleInboundUpdate({ message }).catch((error) => {
    console.error('[dev-poll] Error handling message:', error);
  });
});

bot.on('polling_error', (error) => {
  console.error('[dev-poll] Polling error:', error.message);
});

bot.getMe().then((me) => {
  console.log(`[dev-poll] Connected as @${me.username}`);
}).catch((error) => {
  console.error('[dev-poll] Failed to connect — check TELEGRAM_BOT_TOKEN:', error.message);
});

console.log('Polling started. Send /start <workflow-id> to your bot to test.');