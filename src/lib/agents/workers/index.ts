import { WorkerContext, WorkerResult } from './types';
import * as doc_agent from './doc_agent';
import * as gst_agent from './gst_agent';
import * as pan_agent from './pan_agent';
import * as bank_agent from './bank_agent';
import * as incorporation_agent from './incorporation_agent';
import * as agreement_agent from './agreement_agent';
import * as erp_agent from './erp_agent';

import { checkPrerequisites } from '../../validation/prerequisiteGuard';

async function noopWorker(
  context: WorkerContext
): Promise<WorkerResult> {
  // If plan.targetState is PENDING_APPROVAL and nextWorker is none, this is the deterministic VALIDATING block
  if (context.plan?.targetState === 'PENDING_APPROVAL') {
    const prerequisiteCheck = checkPrerequisites(
      'PENDING_APPROVAL',
      context.extractedFields || {},
      context.documents.map(d => ({
        id: d.id,
        category: d.category,
        verified: d.verified,
      }))
    );

    console.log('[VALIDATING DEBUG] current state: VALIDATING');
    console.log('[VALIDATING DEBUG] next legal states: PENDING_APPROVAL, FAILED, CANCELLED, PAUSED');
    console.log('[VALIDATING DEBUG] selected worker: none');
    console.log('[VALIDATING DEBUG] prerequisite result:', prerequisiteCheck.passed);
    console.log('[VALIDATING DEBUG] incorporation fields:', {
      companyNameMatch: context.extractedFields?.companyNameMatch,
      incorporationCompanyName: context.extractedFields?.incorporationCompanyName
    });

    if (!prerequisiteCheck.passed) {
      console.log('[VALIDATING DEBUG] final worker result: validationPassed=false');
      console.log('[VALIDATING DEBUG] resolved target state: VALIDATING');
      return {
        success: true,
        validationPassed: false,
        outboundMessage: prerequisiteCheck.reason || 'Final validation failed. Please review your submitted documents.',
        retryable: true,
      };
    }
    
    console.log('[VALIDATING DEBUG] final worker result: validationPassed=true');
    console.log('[VALIDATING DEBUG] resolved target state: PENDING_APPROVAL');
  }

  return {
    success: true,
    validationPassed: true,
  };
}

export const WORKER_REGISTRY: Record<
  string,
  (context: WorkerContext) => Promise<WorkerResult>
> = {
  doc_agent: doc_agent.run,
  gst_agent: gst_agent.run,
  pan_agent: pan_agent.run,
  bank_agent: bank_agent.run,
  incorporation_agent: incorporation_agent.run,
  agreement_agent: agreement_agent.run,
  erp_agent: erp_agent.run,
  none: noopWorker,
};

export async function dispatchWorker(
  workerName: string,
  context: WorkerContext
): Promise<WorkerResult> {
  const worker = WORKER_REGISTRY[workerName];

  if (!worker) {
    throw new Error(`Unrecognized worker name: ${workerName}`);
  }

  return worker(context);
}