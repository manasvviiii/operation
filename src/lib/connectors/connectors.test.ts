import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramConnector } from './telegramConnector';
import { ErpConnector } from './erpConnector';
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
      const response = await connector.execute({
        operation: 'sendMessage',
        payload: { chatId: '123', text: 'Hello' }
      });
      
      expect(response).toEqual({ success: true });
      expect(sendMessage).toHaveBeenCalledWith('123', 'Hello');
    });

    it('returns error for unsupported operation', async () => {
      const connector = new TelegramConnector();
      const response = await connector.execute({
        operation: 'unknownOperation',
        payload: {}
      });
      
      expect(response).toEqual({
        success: false,
        error: 'Unsupported operation: unknownOperation'
      });
      expect(sendMessage).not.toHaveBeenCalled();
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
        new ErpConnector()
      ];

      for (const connector of connectors) {
        expect(typeof connector.name).toBe('string');
        const response = await connector.execute({ operation: 'test', payload: {} });
        // We just expect them to conform to the interface and return a valid ConnectorResponse
        expect(response.success).toBe(false); // Since 'test' is unsupported by both
        expect(response.error).toContain('Unsupported operation: test');
      }
    });
  });
});
