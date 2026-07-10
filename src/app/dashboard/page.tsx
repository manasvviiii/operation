import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { stateBadgeClass } from '@/lib/dashboard/stateBadge';
import { getStepLabel } from '@/lib/dashboard/stepLabel';

function formatDate(date: Date): string {
  return date.toLocaleString();
}

export default async function DashboardPage() {
  const workflows = await prisma.workflow.findMany({
    include: { vendor: true },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Workflows</h1>
        <p className="mt-1 text-sm text-zinc-600">
          All vendor onboarding workflows, most recently active first.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">Vendor</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">State</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">Current Step</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">Chat</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">Created</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-600">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No workflows yet. Run the seed script to create one.
                </td>
              </tr>
            ) : (
              workflows.map((workflow) => (
                <tr key={workflow.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/workflows/${workflow.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {workflow.vendor.legalName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${stateBadgeClass(workflow.state)}`}
                    >
                      {workflow.state}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{getStepLabel(workflow.state)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                    {workflow.chatId ?? (
                      <span className="font-sans italic text-zinc-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{formatDate(workflow.createdAt)}</td>
                  <td className="px-4 py-3 text-zinc-600">{formatDate(workflow.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
