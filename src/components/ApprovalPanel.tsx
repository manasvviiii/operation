'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type ApprovalPanelProps = {
  approvalId: string;
  step: string;
};

export function ApprovalPanel({ approvalId, step }: ApprovalPanelProps) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [decidedBy, setDecidedBy] = useState('operator');
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'APPROVED' | 'REJECTED') {
    setLoading(decision === 'APPROVED' ? 'approve' : 'reject');
    setError(null);

    try {
      const response = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, decidedBy, reason: reason || undefined }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to submit decision');
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
      <h2 className="text-lg font-semibold text-amber-900">Pending Approval</h2>
      <p className="mt-1 text-sm text-amber-800">
        Step: <span className="font-medium">{step}</span>
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="decidedBy" className="block text-sm font-medium text-zinc-700">
            Decided by
          </label>
          <input
            id="decidedBy"
            type="text"
            value={decidedBy}
            onChange={(e) => setDecidedBy(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-zinc-700">
            Reason (optional)
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Add context for this decision..."
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => submit('APPROVED')}
          disabled={loading !== null || !decidedBy.trim()}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => submit('REJECTED')}
          disabled={loading !== null || !decidedBy.trim()}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
