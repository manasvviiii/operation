import type { WorkflowState } from '@/lib/stateMachine';

export function getStepLabel(state: WorkflowState | string): string {
  switch (state) {
    case 'INITIATED':
      return 'Waiting for vendor to start';
    case 'AWAITING_GST':
      return 'Awaiting GST details';
    case 'AWAITING_PAN':
      return 'Awaiting PAN details';
    case 'AWAITING_BANK':
      return 'Awaiting bank details';
    case 'VALIDATING':
      return 'Validating details';
    case 'PENDING_APPROVAL':
      return 'Pending operator approval';
    case 'WRITING_ERP':
      return 'Writing to ERP';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'PAUSED':
      return 'Paused';
    default:
      return String(state);
  }
}
