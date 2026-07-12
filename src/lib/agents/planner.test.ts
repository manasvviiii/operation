import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planNext } from './planner';
import { withRetry } from '../retry';
import * as agentTimeline from '../observability/agentTimeline';

vi.mock('../retry', () => ({
  withRetry: vi.fn(),
}));

vi.mock('../observability/agentTimeline', () => ({
  appendAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('planNext returns estimatedCost as null due to lack of pricing registry', async () => {
    (withRetry as any).mockResolvedValue({
      choices: [{ message: { content: '{"nextWorker": "gst_agent", "targetState": "AWAITING_GST", "reasoningSummary": "test"}' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }
    });

    const context = {
      workflow: { id: 'w1', state: 'INITIATED' },
      messages: [],
      documents: [],
      fields: {},
      vendor: {}
    } as any;

    process.env.GROQ_API_KEY = 'test';
    
    const result = await planNext(context);
    
    expect(result.promptTokens).toBe(1000);
    expect(result.totalTokens).toBe(1500);
    expect(result.estimatedCost).toBeNull();
  });
});
