import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getStepLabel } from '@/lib/dashboard/stepLabel';
import { StateBadge } from '@/components/StateBadge';
import { ApprovalPanel } from '@/components/ApprovalPanel';

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

type WorkflowDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  const { id } = await params;

  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: { vendor: true },
  });

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="p-4 rounded-full bg-zinc-100 text-zinc-400">
          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-zinc-900">Workflow Not Found</h2>
        <p className="text-sm text-zinc-500">The workflow link you followed may be invalid or has been deleted.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-zinc-800 transition-colors"
        >
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  const [messages, auditLogs, executions, pendingApproval] = await Promise.all([
    prisma.message.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.auditLog.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.execution.findMany({
      where: { workflowId: id },
      include: { agentRuns: true },
      orderBy: { startedAt: 'asc' },
    }),
    prisma.approval.findFirst({
      where: { workflowId: id, decision: 'PENDING' },
    }),
  ]);

  // Combine messages and audit logs
  type TimelineItem =
    | { type: 'message'; key: string; date: Date; data: typeof messages[number] }
    | { type: 'audit'; key: string; date: Date; data: typeof auditLogs[number] };

  const timelineItems: TimelineItem[] = [
    ...messages.map((m) => ({ type: 'message' as const, key: `msg-${m.id}`, date: m.createdAt, data: m })),
    ...auditLogs.map((a) => ({ type: 'audit' as const, key: `audit-${a.id}`, date: a.createdAt, data: a })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          ← Back to Workflows
        </Link>
      </div>

      {/* Header Card */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{workflow.vendor.legalName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
              {workflow.vendor.contactEmail && (
                <span>Email: <span className="text-zinc-700">{workflow.vendor.contactEmail}</span></span>
              )}
              {workflow.vendor.contactEmail && workflow.vendor.taxId && (
                <span className="text-zinc-300">•</span>
              )}
              {workflow.vendor.taxId && (
                <span>Tax ID: <span className="font-mono text-zinc-700">{workflow.vendor.taxId}</span></span>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-sm font-medium text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
              Step: {getStepLabel(workflow.state)}
            </div>
            <StateBadge state={workflow.state} />
          </div>
        </div>
      </div>

      {/* Operator Action / Pending Approval Section */}
      {pendingApproval && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-1 shadow-sm">
          <ApprovalPanel approvalId={pendingApproval.id} step={getStepLabel(workflow.state)} />
        </div>
      )}

      {/* Timeline Section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-900">Timeline & Chat Logs</h2>
        
        <div className="relative border-l border-zinc-200 ml-4 pl-6 space-y-6 py-2">
          {timelineItems.length === 0 ? (
            <div className="text-sm text-zinc-500 italic pl-2">No events recorded yet.</div>
          ) : (
            timelineItems.map((item) => {
              if (item.type === 'message') {
                const isOutbound = item.data.direction === 'OUTBOUND';
                return (
                  <div key={item.key} className="relative group">
                    {/* Timeline dot */}
                    <div className="absolute -left-[31px] top-4 h-2 w-2 rounded-full border border-zinc-300 bg-white ring-4 ring-white" />
                    
                    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm shadow-sm max-w-xl border ${
                          isOutbound
                            ? 'bg-blue-50 border-blue-200/60 text-blue-900 rounded-tr-none'
                            : 'bg-zinc-50 border-zinc-200 text-zinc-900 rounded-tl-none'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-6 mb-1 text-[11px] font-medium opacity-60">
                          <span>{isOutbound ? 'Outbound Message' : 'Inbound Message'}</span>
                          <span title={item.date.toLocaleString()}>{timeAgo(item.date)}</span>
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed">{item.data.content}</div>
                      </div>
                    </div>
                  </div>
                );
              } else {
                const log = item.data;
                const metadata = log.metadata as any;
                const reason = metadata?.reason || metadata?.error || null;
                
                return (
                  <div key={item.key} className="relative group flex items-start gap-3">
                    {/* Timeline dot */}
                    <div className="absolute -left-[32px] top-1.5 h-3.5 w-3.5 rounded-full border border-zinc-300 bg-zinc-50 flex items-center justify-center ring-4 ring-white">
                      <div className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    </div>

                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl px-4 py-2.5 text-xs text-zinc-600 w-full shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div>
                          <span className="font-semibold text-zinc-700 capitalize">{log.actor}</span>{' '}
                          <span className="text-zinc-600">performed</span>{' '}
                          <code className="px-1 py-0.5 rounded bg-zinc-100 font-mono text-[11px] text-zinc-800">
                            {log.action}
                          </code>
                          {log.fromState && log.toState && (
                            <span className="ml-1 text-zinc-500">
                              ({log.fromState} → {log.toState})
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-medium shrink-0" title={item.date.toLocaleString()}>
                          {timeAgo(item.date)}
                        </span>
                      </div>
                      {reason && (
                        <div className="mt-1.5 text-zinc-500 pl-3 border-l border-zinc-200 italic whitespace-pre-wrap">
                          Note: {reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
            })
          )}
        </div>
      </div>

      {/* Technical Details Section */}
      <div className="border-t border-zinc-200 pt-6">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-semibold text-zinc-500 hover:text-zinc-800 transition-colors">
            <span>Technical Details & Executions ({executions.length})</span>
            <span className="transition-transform group-open:rotate-180">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </summary>
          <div className="mt-4 space-y-4">
            {executions.length === 0 ? (
              <div className="text-xs text-zinc-500 italic">No executions triggered yet.</div>
            ) : (
              executions.map((exec) => (
                <div key={exec.id} className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-zinc-800">Trigger:</span>{' '}
                      <span className="font-mono text-zinc-600 bg-zinc-100 px-1 py-0.5 rounded">{exec.triggerSource}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        exec.status === 'COMPLETED' || exec.status === 'success' || exec.status === 'done'
                          ? 'bg-green-100 text-green-800'
                          : exec.status === 'FAILED' || exec.status === 'failed' || exec.status === 'error'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-zinc-100 text-zinc-800'
                      }`}>
                        {exec.status}
                      </span>
                      <span className="text-zinc-400" title={exec.startedAt.toLocaleString()}>
                        Started {timeAgo(exec.startedAt)}
                      </span>
                    </div>
                  </div>
                  {exec.errorMessage && (
                    <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-100 whitespace-pre-wrap font-mono">
                      Error: {exec.errorMessage}
                    </div>
                  )}

                  {/* Agent Runs */}
                  {exec.agentRuns.length > 0 && (
                    <div className="border-t border-zinc-100 pt-3 space-y-2">
                      <div className="text-xs font-semibold text-zinc-700">Agent Executions:</div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-[11px] text-zinc-500">
                          <thead>
                            <tr className="border-b border-zinc-200 text-zinc-700 font-medium">
                              <th className="pb-1.5 pr-2">Agent</th>
                              <th className="pb-1.5 px-2">Status</th>
                              <th className="pb-1.5 px-2">Tokens</th>
                              <th className="pb-1.5 pl-2 text-right">Started</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {exec.agentRuns.map((run) => (
                              <tr key={run.id} className="hover:bg-zinc-100/50">
                                <td className="py-1.5 pr-2 font-semibold text-zinc-800">{run.agentName}</td>
                                <td className="py-1.5 px-2 font-mono">{run.status}</td>
                                <td className="py-1.5 px-2 font-mono">{run.tokens}</td>
                                <td className="py-1.5 pl-2 text-right text-zinc-400" title={run.startedAt.toLocaleString()}>
                                  {timeAgo(run.startedAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
