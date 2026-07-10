export type WorkflowState =
  | 'INITIATED'
  | 'AWAITING_GST'
  | 'AWAITING_PAN'
  | 'AWAITING_BANK'
  | 'VALIDATING'
  | 'PENDING_APPROVAL'
  | 'WRITING_ERP'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

interface TransitionMap {
  [key: string]: WorkflowState[];
}

export const TRANSITION_MAP: TransitionMap = {
  INITIATED: ['AWAITING_GST', 'FAILED', 'CANCELLED', 'PAUSED'],
  AWAITING_GST: ['AWAITING_PAN', 'FAILED', 'CANCELLED', 'PAUSED'],
  AWAITING_PAN: ['AWAITING_BANK', 'FAILED', 'CANCELLED', 'PAUSED'],
  AWAITING_BANK: ['VALIDATING', 'FAILED', 'CANCELLED', 'PAUSED'],
  VALIDATING: ['PENDING_APPROVAL', 'FAILED', 'CANCELLED', 'PAUSED'],
  PENDING_APPROVAL: ['WRITING_ERP', 'FAILED', 'CANCELLED', 'PAUSED'],
  WRITING_ERP: ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  PAUSED: ['FAILED', 'CANCELLED'],
};

export function validateTransition(from: WorkflowState, to: WorkflowState): void {
  const allowedTransitions = TRANSITION_MAP[from];
  
  if (!allowedTransitions.includes(to)) {
    throw new Error(
      `Invalid state transition from ${from} to ${to}. Allowed transitions: ${allowedTransitions.join(', ')}`
    );
  }
}
