import type { WorkflowState } from '@/lib/stateMachine';

export function stateBadgeClass(state: WorkflowState | string): string {
  switch (state) {
    case 'PENDING_APPROVAL':
      return 'bg-amber-100 text-amber-900 ring-amber-300';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 ring-green-300';
    case 'FAILED':
      return 'bg-red-100 text-red-800 ring-red-300';
    case 'CANCELLED':
      return 'bg-zinc-100 text-zinc-600 ring-zinc-300';
    case 'PAUSED':
      return 'bg-orange-100 text-orange-800 ring-orange-300';
    case 'WRITING_ERP':
      return 'bg-blue-100 text-blue-800 ring-blue-300';
    default:
      return 'bg-slate-100 text-slate-700 ring-slate-300';
  }
}
