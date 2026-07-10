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
  
  async function submit(decision: 'APPROVED' | 'REJECTED') {
    setLoading(true);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (response.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-5 border rounded-lg bg-amber-50 border-amber-300">
      <h2 className="font-semibold text-amber-900">Pending Approval</h2>
      <p className="text-sm text-amber-800">Step: {step}</p>
      <div className="flex gap-3 mt-4">
        <button 
            onClick={() => submit('APPROVED')} 
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-md"
            disabled={loading}
        >
          {loading ? 'Processing...' : 'Approve'}
        </button>
      </div>
    </div>
  );
}