import { WorkerContext, WorkerResult } from './types';
import * as doc_agent from './doc_agent';
import * as gst_agent from './gst_agent';
import * as pan_agent from './pan_agent';
import * as bank_agent from './bank_agent';
import * as incorporation_agent from './incorporation_agent';
import * as agreement_agent from './agreement_agent';
import * as erp_agent from './erp_agent';

async function noopWorker(
  _context: WorkerContext
): Promise<WorkerResult> {
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