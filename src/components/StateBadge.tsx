import React from 'react';

export function StateBadge({ state }: { state: string }) {
  let bg = 'bg-slate-50 border-slate-200 text-slate-700';
  let dot = 'bg-slate-400';
  let label = state;
  let pulse = false;

  switch (state) {
    case 'PENDING_APPROVAL':
      bg = 'bg-amber-50 border-amber-300 text-amber-900 font-semibold';
      dot = 'bg-amber-500';
      pulse = true;
      break;
    case 'VALIDATING':
      bg = 'bg-amber-50 border-amber-200 text-amber-800';
      dot = 'bg-amber-400';
      break;
    case 'COMPLETED':
      bg = 'bg-green-50 border-green-200 text-green-800';
      dot = 'bg-green-500';
      break;
    case 'FAILED':
      bg = 'bg-red-50 border-red-200 text-red-800';
      dot = 'bg-red-500';
      break;
    case 'CANCELLED':
    case 'PAUSED':
      bg = 'bg-zinc-50 border-zinc-200 border-dashed text-zinc-500';
      dot = 'bg-zinc-400';
      break;
    case 'WRITING_ERP':
      bg = 'bg-blue-50 border-blue-200 text-blue-800';
      dot = 'bg-blue-500';
      break;
    default: // INITIATED, AWAITING_*
      bg = 'bg-slate-50 border-slate-200 text-slate-700';
      dot = 'bg-slate-400';
      break;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${bg}`}>
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dot}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
