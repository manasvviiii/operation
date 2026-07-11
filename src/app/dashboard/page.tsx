import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getStepLabel } from '@/lib/dashboard/stepLabel';
import { StateBadge } from '@/components/StateBadge';

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + 'y ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + 'mo ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + 'd ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + 'h ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + 'm ago';
  if (seconds < 10) return 'just now';
  return Math.floor(seconds) + 's ago';
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const workflows = await prisma.workflow.findMany({
    include: { vendor: true },
    orderBy: { updatedAt: 'desc' },
  });

  workflows.forEach(w => {
    console.log(`[DASHBOARD STATE DEBUG] source=list`);
    console.log(`[DASHBOARD STATE DEBUG] workflowId=${w.id}`);
    console.log(`[DASHBOARD STATE DEBUG] prismaState=${w.state}`);
    console.log(`[DASHBOARD STATE DEBUG] returnedState=${w.state}`);
    console.log(`[DASHBOARD STATE DEBUG] component=DashboardPage`);
    console.log(`[DASHBOARD STATE DEBUG] renderedState=${w.state}`);
  });

  const total = workflows.length;
  const pending = workflows.filter((w) => w.state === 'PENDING_APPROVAL').length;
  const completed = workflows.filter((w) => w.state === 'COMPLETED').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Workflows</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Monitor and manage vendor onboarding workflows.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-zinc-500">Total Workflows</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{total}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-zinc-500">Pending Approval</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600">{pending}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-zinc-500">Completed</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-900">{completed}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50/80 sticky top-0 backdrop-blur">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-zinc-500">Vendor</th>
                <th className="px-5 py-3 text-left font-medium text-zinc-500">Status</th>
                <th className="px-5 py-3 text-right font-medium text-zinc-500">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {workflows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-12 text-center text-zinc-500">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <svg
                        className="h-8 w-8 text-zinc-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>No workflows found. Run the seed script to create one.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                workflows.map((workflow) => (
                  <tr key={workflow.id} className="group hover:bg-zinc-50/80 transition-colors">
                    <td className="px-5 py-4">
                      <Link
                        href={`/dashboard/workflows/${workflow.id}`}
                        className="block focus:outline-none"
                      >
                        <div className="font-semibold text-zinc-900 group-hover:text-blue-600 transition-colors">
                          {workflow.vendor.legalName}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                          <span>{getStepLabel(workflow.state)}</span>
                          <span className="text-zinc-300">•</span>
                          <span className="font-mono">{workflow.chatId ? 'Linked' : 'No Chat'}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <StateBadge state={workflow.state} />
                    </td>
                    <td className="px-5 py-4 text-right text-zinc-500">
                      <span title={workflow.updatedAt.toLocaleString()}>
                        {timeAgo(workflow.updatedAt)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
