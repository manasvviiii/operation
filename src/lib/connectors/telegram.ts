import TelegramBot, { Message as TelegramMessage } from 'node-telegram-bot-api';

export type InboundMessage = {
  workflowId?: string;
  chatId: string;
  senderId: string;
  body: string;
  attachments?: unknown;
  externalMessageId?: string;
  ts: Date;
};

let bot: TelegramBot | null = null;

export function getBot(): TelegramBot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
  }

  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
  }

  return bot;
}

export function normalizeUpdate(update: any): InboundMessage | null {
  const message = update.message;
  if (!message?.chat?.id || !message.from?.id) {
    return null;
  }

  const body = message.text ?? '';
  let workflowId: string | undefined;

  if (body.startsWith('/start ')) {
    workflowId = body.slice('/start '.length).trim() || undefined;
  }

  return {
    workflowId,
    chatId: String(message.chat.id),
    senderId: String(message.from.id),
    body,
    attachments: message.document ?? message.photo ?? message.video ?? undefined,
    externalMessageId: update.update_id ? `inbound:telegram:${update.update_id}` : (message.message_id != null ? String(message.message_id) : undefined),
    ts: new Date(message.date * 1000),
  };
}

export async function sendMessage(chatId: string, text: string): Promise<TelegramMessage> {
  return await getBot().sendMessage(chatId, text);
}
