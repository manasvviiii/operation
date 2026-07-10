import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import type { WorkflowState } from '../stateMachine';

export interface Plan {
  nextWorker: string;
  targetState: WorkflowState;
  reasoningSummary: string;
}

export interface PlanContext {
  workflow: {
    id: string;
    state: string;
    currentStep: string;
    vendorId: string;
  };
  vendor: {
    id: string;
    legalName: string;
    contactEmail: string | null;
    status: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
  auditLogs: Array<{
    id: string;
    actor: string;
    action: string;
    fromState?: string;
    toState?: string;
    createdAt: Date;
  }>;
}

const PlanSchema = z.object({
  nextWorker: z.enum(['doc_agent', 'gst_agent', 'pan_agent', 'bank_agent', 'erp_agent']),
  targetState: z.enum([
    'INITIATED',
    'AWAITING_GST',
    'AWAITING_PAN',
    'AWAITING_BANK',
    'VALIDATING',
    'PENDING_APPROVAL',
    'WRITING_ERP',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'PAUSED',
  ]),
  reasoningSummary: z.string(),
});

export async function planNext(context: PlanContext): Promise<Plan> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' }
  });

  const systemPrompt = `You are a workflow planner for a Vendor Onboarding system. Your job is to analyze the current state of a vendor onboarding workflow and decide:
1. Which worker agent should be dispatched next
2. What target state the workflow should transition to

Available workers:
- doc_agent: Handles document collection and processing
- gst_agent: Handles GST information collection
- pan_agent: Handles PAN information collection  
- bank_agent: Handles bank details collection
- erp_agent: Handles ERP system integration

Available workflow states:
- INITIATED: Workflow just started
- AWAITING_GST: Waiting for GST information
- AWAITING_PAN: Waiting for PAN information
- AWAITING_BANK: Waiting for bank details
- VALIDATING: Validating collected information
- PENDING_APPROVAL: Awaiting human approval
- WRITING_ERP: Writing data to ERP system
- COMPLETED: Workflow finished successfully
- FAILED: Workflow failed
- CANCELLED: Workflow cancelled
- PAUSED: Workflow paused

You will be provided with:
- Current workflow state and step
- Vendor information
- Recent messages from the vendor
- Recent audit log history

Respond ONLY with valid JSON matching this schema:
{
  "nextWorker": "doc_agent" | "gst_agent" | "pan_agent" | "bank_agent" | "erp_agent",
  "targetState": "INITIATED" | "AWAITING_GST" | "AWAITING_PAN" | "AWAITING_BANK" | "VALIDATING" | "PENDING_APPROVAL" | "WRITING_ERP" | "COMPLETED" | "FAILED" | "CANCELLED" | "PAUSED",
  "reasoningSummary": "string explaining your decision"
}`;

  const contextData = JSON.stringify({
    workflow: context.workflow,
    vendor: context.vendor,
    messages: context.messages,
    auditLogs: context.auditLogs,
  }, null, 2);

  const prompt = `${systemPrompt}\n\nContext:\n${contextData}`;

  let responseText = '';
  
  try {
    const response = await model.generateContent(prompt);
    responseText = response.response.text();

    // Strip markdown code fences if present (defensive, though JSON mode shouldn't add them)
    const cleanedText = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsedPlan = JSON.parse(cleanedText);
    
    const validatedPlan = PlanSchema.parse(parsedPlan);
    
    return validatedPlan;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Plan validation failed. Model returned invalid schema: ${JSON.stringify(error.issues, null, 2)}`
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse model response as JSON. Response was: ${responseText}`
      );
    }
    throw error;
  }
}
