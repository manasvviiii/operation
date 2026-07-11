import Groq from 'groq-sdk';
import { z } from 'zod';
import { withRetry } from '../retry';
import { validateTransition, type WorkflowState } from '../stateMachine';

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
  nextWorker: z.enum(['doc_agent', 'gst_agent', 'pan_agent', 'bank_agent', 'incorporation_agent', 'agreement_agent', 'erp_agent']),
  targetState: z.enum([
    'INITIATED',
    'AWAITING_GST',
    'AWAITING_PAN',
    'AWAITING_BANK',
    'AWAITING_INCORPORATION',
    'AWAITING_AGREEMENT',
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

import fs from 'fs';
import path from 'path';

export function loadPrompt(agentName: string, version: string): string {
  const filePath = path.join(process.cwd(), 'prompts', agentName, `${version}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found for agent ${agentName}, version ${version}`);
  }
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  // Strip YAML frontmatter (everything between the first two '---' markers)
  const promptText = fileContent.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  if (!promptText) {
    throw new Error(`Prompt text is empty after stripping frontmatter for ${agentName} v${version}`);
  }
  return promptText;
}

export async function planNext(context: PlanContext): Promise<{ plan: Plan; tokensUsed: number }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set in environment variables');
  }

  const groq = new Groq({ apiKey });

  const contextData = JSON.stringify(
    {
      workflow: context.workflow,
      vendor: context.vendor,
      messages: context.messages,
      auditLogs: context.auditLogs,
    },
    null,
    2
  );

  const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: loadPrompt('planner', 'v1') },
    { role: 'user', content: `Context:\n${contextData}` },
  ];

  let responseText = '';
  let totalTokensUsed = 0;
  const MAX_ATTEMPTS = 2; // 1 initial attempt + 1 corrective retry on illegal transition

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await withRetry(
        () =>
          groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: chatMessages,
            response_format: { type: 'json_object' },
            temperature: 0.3,
          }),
        {
          maxAttempts: 4,
          baseDelayMs: 300,
          onRetry: (retryAttempt, err) => console.warn(`[planner] Groq call retry ${retryAttempt}:`, err),
        }
      );

      responseText = completion.choices[0]?.message?.content ?? '';
      totalTokensUsed += completion.usage?.total_tokens ?? 0;

      const cleanedText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      const parsedPlan = JSON.parse(cleanedText);
      const validatedPlan = PlanSchema.parse(parsedPlan);

      // The Zod schema only checks nextWorker/targetState are individually valid
      // enum values — it doesn't know which (state -> targetState) pairs are legal
      // edges in the state graph. Cross-check that here. A same-state "transition"
      // (planner wants to stay and re-prompt) is always fine and skips this check.
      if (validatedPlan.targetState !== context.workflow.state) {
        try {
          validateTransition(context.workflow.state as WorkflowState, validatedPlan.targetState);
        } catch (transitionError) {
          const message = transitionError instanceof Error ? transitionError.message : String(transitionError);
          if (attempt < MAX_ATTEMPTS) {
            console.warn(`[planner] Proposed illegal transition on attempt ${attempt}, retrying with corrective feedback:`, message);
            chatMessages.push({ role: 'assistant', content: responseText });
            chatMessages.push({
              role: 'user',
              content: `That plan proposed an invalid state transition: ${message}. Return a corrected JSON plan with a legal targetState for the current state.`,
            });
            continue;
          }
          // Out of retries — return the plan as-is. runAgentLoop's own legality
          // check will catch this and keep the workflow's state unchanged, so
          // this isn't unsafe, just not self-corrected.
          console.error(`[planner] Still proposing illegal transition after ${MAX_ATTEMPTS} attempts, returning as-is:`, message);
        }
      }

      return { plan: validatedPlan, tokensUsed: totalTokensUsed };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Plan validation failed. Model returned: ${responseText}. Validation issues: ${JSON.stringify(error.issues, null, 2)}`
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

  // Unreachable, but keeps TypeScript satisfied
  throw new Error('[planner] planNext exhausted attempts without returning a plan');
}