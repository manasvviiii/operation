'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ApprovalPanelProps = {
  approvalId: string;
  step: string;
};

export function ApprovalPanel({ approvalId, step }: ApprovalPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [reason, setReason] = useState('');
  
  async function submit(decision: 'APPROVED' | 'REJECTED') {
    setLoading(true);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      if (response.ok) {
        router.refresh();
      } else {
        alert('Failed to process approval.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-amber-900">Human Approval Required</h2>
          <p className="mt-1 text-sm text-amber-800">
            This workflow is paused at the <span className="font-semibold">{step}</span> step. Review the timeline below and make a decision.
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200">
          <svg className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      </div>
      
      <div className="mt-6">
        <label htmlFor="reason" className="block text-sm font-medium text-amber-900">
          Reason / Notes (Optional)
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Add any notes about your decision..."
          className="mt-2 block w-full rounded-lg border-amber-300 bg-white/70 px-4 py-2 text-sm text-zinc-900 shadow-sm focus:border-amber-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50 transition-colors"
          disabled={loading}
        />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button 
          onClick={() => submit('APPROVED')} 
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-amber-50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Processing...' : 'Approve'}
        </button>
        <button 
          onClick={() => submit('REJECTED')} 
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg border border-red-600 bg-transparent px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-amber-50 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Processing...' : 'Reject'}
        </button>
      </div>
    </div>
  );
}