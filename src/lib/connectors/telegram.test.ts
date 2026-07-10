import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn().mockImplementation(function () {
    return { sendMessage: vi.fn().mockResolvedValue(undefined) };
  }),
}));

import { normalizeUpdate, getBot, sendMessage } from './telegram';

describe('normalizeUpdate', () => {
  it('parses a plain text message correctly', () => {
    const update = {
      message: {
        chat: { id: 123456 },
        from: { id: 789012 },
        text: 'hello there',
        message_id: 42,
        date: 1735689600, // seconds
      },
    };

    const result = normalizeUpdate(update);

    expect(result).not.toBeNull();
    expect(result?.chatId).toBe('123456');
    expect(result?.senderId).toBe('789012');
    expect(result?.body).toBe('hello there');
    expect(result?.externalMessageId).toBe('42');
    expect(result?.workflowId).toBeUndefined();
    expect(result?.ts).toBeInstanceOf(Date);
    expect(result?.ts.getTime()).toBe(1735689600 * 1000);
  });

  it('extracts workflowId from a /start deep-link message', () => {
    const update = {
      message: {
        chat: { id: 123456 },
        from: { id: 789012 },
        text: '/start 7529ef02-7f11-4f4e-8eb3-d6632a2385e3',
        message_id: 43,
        date: 1735689600,
      },
    };

    const result = normalizeUpdate(update);

    expect(result?.workflowId).toBe('7529ef02-7f11-4f4e-8eb3-d6632a2385e3');
  });

  it('leaves workflowId undefined for a bare "/start" with no payload', () => {
    const update = {
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        text: '/start ',
        message_id: 1,
        date: 1735689600,
      },
    };

    const result = normalizeUpdate(update);
    expect(result?.workflowId).toBeUndefined();
  });

  it('returns null when message.chat.id is missing', () => {
    const update = { message: { from: { id: 2 }, text: 'hi', date: 1735689600 } };
    expect(normalizeUpdate(update)).toBeNull();
  });

  it('returns null when message.from.id is missing', () => {
    const update = { message: { chat: { id: 1 }, text: 'hi', date: 1735689600 } };
    expect(normalizeUpdate(update)).toBeNull();
  });

  it('returns null for a non-message update (e.g. edited_message only)', () => {
    const update = { edited_message: { text: 'edited' } };
    expect(normalizeUpdate(update)).toBeNull();
  });

  it('defaults body to empty string when text is absent', () => {
    const update = {
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        date: 1735689600,
        message_id: 5,
      },
    };
    const result = normalizeUpdate(update);
    expect(result?.body).toBe('');
  });

  it('captures a document attachment when present', () => {
    const update = {
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        text: '',
        date: 1735689600,
        message_id: 6,
        document: { file_id: 'doc-1' },
      },
    };
    const result = normalizeUpdate(update);
    expect(result?.attachments).toEqual({ file_id: 'doc-1' });
  });
});

describe('getBot', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  it('throws if TELEGRAM_BOT_TOKEN is not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { getBot: freshGetBot } = await import('./telegram');
    expect(() => freshGetBot()).toThrow('TELEGRAM_BOT_TOKEN is not set');
  });
});

describe('sendMessage', () => {
  it('calls bot.sendMessage with chatId and text', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    await sendMessage('chat-1', 'hello');
    const mockInstance = (TelegramBot as any).mock.results[0]?.value;
    expect(mockInstance.sendMessage).toHaveBeenCalledWith('chat-1', 'hello');
  });
});