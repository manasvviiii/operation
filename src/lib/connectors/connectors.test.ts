import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramConnector } from './telegramConnector';
import { ErpConnector } from './erpConnector';
import { InMemoryConnector } from './inMemoryConnector';
import { sendMessage } from './telegram';
import { Connector } from './types';

// Mock telegram module
vi.mock('./telegram', () => ({
  sendMessage: vi.fn(),
}));

describe('Connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TelegramConnector', () => {
    it('executes sendMessage operation successfully', async () => {
      const connector = new TelegramConnector();
      const response = await connector.sendMessage({
        channelId: '123',
        text: 'Hello'
      });
      
      expect(response).toEqual({ success: true });
      expect(sendMessage).toHaveBeenCalledWith('123', 'Hello');
    });
  });

  describe('ErpConnector', () => {
    it('executes createVendorRecord operation successfully', async () => {
      const connector = new ErpConnector();
      const response = await connector.execute({
        operation: 'createVendorRecord',
        payload: { workflowId: 'wf-1', vendorId: 'v-1' }
      });
      
      expect(response.success).toBe(true);
      expect(response.data?.recordId).toEqual(expect.any(String));
    });

    it('returns error for unsupported operation', async () => {
      const connector = new ErpConnector();
      const response = await connector.execute({
        operation: 'deleteVendorRecord',
        payload: {}
      });
      
      expect(response).toEqual({
        success: false,
        error: 'Unsupported operation: deleteVendorRecord'
      });
    });
  });

  describe('Connector Interface', () => {
    it('allows different connectors to be used interchangeably', async () => {
      const connectors: Connector[] = [
        new TelegramConnector(),
        new InMemoryConnector()
      ];

      for (const connector of connectors) {
        expect(typeof connector.id).toBe('string');
        const response = await connector.sendMessage({ channelId: '123', text: 'test' });
        expect(response.success).toBe(true);
      }
    });
  });
});
