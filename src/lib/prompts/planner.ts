import { OpenAI } from 'openai';
import { z } from 'zod';
import type { WorkflowState } from '../stateMachine';

// Define the interface that the orchestrator expects
export interface Plan {
  nextWorker: 'doc_agent' | 'gst_agent' | 'pan_agent' | 'bank_agent' | 'erp_agent';
  targetState: WorkflowState;
  reasoningSummary: string;
}

// Define the context structure
export interface PlanContext {
  workflow: { id: string; state: string; currentStep: string; vendorId: string };
  vendor: { id: string; legalName: string; contactEmail: string | null; status: string };
  messages: Array<{ id: string; role: string; content: string; createdAt: Date }>;
  auditLogs: Array<{ id: string; actor: string; action: string; createdAt: Date }>;
}

const PlanSchema = z.object({
  nextWorker: z.enum(['doc_agent', 'gst_agent', 'pan_agent', 'bank_agent', 'erp_agent']),
  targetState: z.enum([
    'INITIATED', 'AWAITING_GST', 'AWAITING_PAN', 'AWAITING_BANK',
    'VALIDATING', 'PENDING_APPROVAL', 'WRITING_ERP', 'COMPLETED',
    'FAILED', 'CANCELLED', 'PAUSED',
  ]),
  reasoningSummary: z.string(),
});

export async function planNext(context: PlanContext): Promise<Plan> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const systemPrompt = `You are a workflow planner for a Vendor Onboarding system. 
  Your goal is to decide the next worker agent and the target workflow state.
  Respond ONLY with a JSON object.`;

  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(context, null, 2) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('No response from Groq');

  return PlanSchema.parse(JSON.parse(content));
}