import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { StateBadge } from '@/components/StateBadge';
import { getStepLabel } from '@/lib/dashboard/stepLabel';
import { prisma } from '@/lib/prisma';

type TimelineEntry =
  | {
      kind: 'message';
      ts: Date;
      direction: string;
      role: string;
      channel: string;
      content: string;
    }
  | {
      kind: 'audit';
      ts: Date;
      actor: string;
      action: string;
      fromState: string | null;
      toState: string | null;
      metadata: unknown;
    }
  | {
      kind: 'execution';
      ts: Date;
      triggerSource: string;
      status: string;
      endedAt: Date | null;
      errorMessage: string | null;
    }
  | {
      kind: 'agentRun';
      ts: Date;
      agentName: string;
      status: string;
      tokens: number;
      latencyMs: number | null;
      executionId: string;
    };

function formatDate(date: Date): string {
  return date.toLocaleString();
}

function formatTimeOnly(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(date: Date): string {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMetadata(metadata: unknown): string | null {
  if (metadata == null) return null;
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: {
      vendor: true,
      messages: { orderBy: { createdAt: 'asc' } },
      auditLogs: { orderBy: { createdAt: 'asc' } },
      approvals: { orderBy: { requestedAt: 'desc' } },
      executions: {
        orderBy: { startedAt: 'asc' },
        include: { agentRuns: { orderBy: { startedAt: 'asc' } } },
      },
    },
  });

  if (!workflow) {
    notFound();
  }

  const pendingApproval = workflow.approvals.find((a) => a.decision === 'PENDING');

  const timeline: TimelineEntry[] = [
    ...workflow.messages.map((message) => ({
      kind: 'message' as const,
      ts: message.createdAt,
      direction: message.direction,
      role: message.role,
      channel: message.channel,
      content: message.content,
    })),
    ...workflow.auditLogs.map((log) => ({
      kind: 'audit' as const,
      ts: log.createdAt,
      actor: log.actor,
      action: log.action,
      fromState: log.fromState,
      toState: log.toState,
      metadata: log.metadata,
    })),
    ...workflow.executions.flatMap((execution) => {
      const executionEntry: TimelineEntry = {
        kind: 'execution',
        ts: execution.startedAt,
        triggerSource: execution.triggerSource,
        status: execution.status,
        endedAt: execution.endedAt,
        errorMessage: execution.errorMessage,
      };

      const agentRunEntries: TimelineEntry[] = execution.agentRuns.map((run) => ({
        kind: 'agentRun',
        ts: run.startedAt,
        agentName: run.agentName,
        status: run.status,
        tokens: run.tokens,
        latencyMs: run.latencyMs,
        executionId: execution.id,
      }));

      return [executionEntry, ...agentRunEntries];
    }),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="group inline-flex items-center text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors">
          <svg className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to workflows
        </Link>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{workflow.vendor.legalName}</h1>
            <div className="mt-4 flex flex-wrap gap-y-4 gap-x-8 text-sm">
              <div>
                <dt className="text-zinc-500 font-medium">Contact email</dt>
                <dd className="mt-1 text-zinc-900">{workflow.vendor.contactEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 font-medium">Tax ID</dt>
                <dd className="mt-1 text-zinc-900">{workflow.vendor.taxId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 font-medium">Current step</dt>
                <dd className="mt-1 text-zinc-900">{getStepLabel(workflow.state)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 font-medium">Chat ID</dt>
                <dd className="mt-1 font-mono text-zinc-900">
                  {workflow.chatId ?? <span className="text-zinc-400 italic font-sans">Not linked</span>}
                </dd>
              </div>
            </div>
          </div>
          <div className="flex-shrink-0">
            <StateBadge state={workflow.state} />
          </div>
        </div>
      </section>

      {pendingApproval && (
        <ApprovalPanel approvalId={pendingApproval.id} step={pendingApproval.step} />
      )}

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-zinc-200 bg-zinc-50/80 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900">Workflow Timeline</h2>
        </div>
        
        <div className="p-6">
          {timeline.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              No activity recorded yet for this workflow.
            </div>
          ) : (
            <div className="relative border-l-2 border-zinc-200 ml-4 space-y-8 pb-4">
              {timeline.map((entry, index) => {
                const isMessage = entry.kind === 'message';
                const isAudit = entry.kind === 'audit';
                const isTech = entry.kind === 'execution' || entry.kind === 'agentRun';

                return (
                  <div key={`${entry.kind}-${entry.ts.toISOString()}-${index}`} className="relative pl-8">
                    {/* Timeline Dot/Icon */}
                    <div className="absolute -left-[1.0625rem] top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white ring-2 ring-zinc-200">
                      {isMessage && entry.direction === 'INBOUND' && (
                        <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      )}
                      {isMessage && entry.direction === 'OUTBOUND' && (
                        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                        </svg>
                      )}
                      {isAudit && (
                        <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {isTech && (
                        <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium text-zinc-900">
                        {isMessage && (entry.direction === 'INBOUND' ? 'Vendor Message' : 'System Message')}
                        {isAudit && 'System Event'}
                        {isTech && 'Technical Detail'}
                      </span>
                      <span className="text-xs text-zinc-500" title={formatDate(entry.ts)}>
                        {formatDateOnly(entry.ts)} at {formatTimeOnly(entry.ts)}
                      </span>
                    </div>

                    {isMessage && (
                      <div className={`mt-2 rounded-xl p-4 text-sm shadow-sm border ${entry.direction === 'INBOUND' ? 'bg-blue-50/50 border-blue-100 text-blue-900' : 'bg-green-50/50 border-green-100 text-green-900'}`}>
                        <p className="whitespace-pre-wrap">{entry.content}</p>
                      </div>
                    )}

                    {isAudit && (
                      <div className="mt-2 rounded-xl bg-zinc-50 border border-zinc-200 p-4 text-sm text-zinc-800 shadow-sm">
                        <p className="font-medium">{entry.action}</p>
                        {(entry.fromState || entry.toState) && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                            <span className="rounded bg-zinc-200 px-2 py-1 font-mono">{entry.fromState ?? '—'}</span>
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            <span className="rounded bg-zinc-200 px-2 py-1 font-mono">{entry.toState ?? '—'}</span>
                          </div>
                        )}
                        {formatMetadata(entry.metadata) && (
                          <details className="mt-3 group">
                            <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700">View Metadata</summary>
                            <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-800 p-3 text-xs text-zinc-200">
                              {formatMetadata(entry.metadata)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}

                    {isTech && entry.kind === 'execution' && (
                      <details className="mt-2 group rounded-xl border border-zinc-200 bg-white">
                        <summary className="cursor-pointer p-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 focus:outline-none">
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-mono border border-zinc-200">Execution</span>
                            <span className="text-zinc-500 text-xs">trigger: {entry.triggerSource}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${entry.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-700'}`}>
                              {entry.status}
                            </span>
                          </div>
                        </summary>
                        <div className="border-t border-zinc-100 p-3 text-xs text-zinc-600 space-y-1 bg-zinc-50/50">
                          {entry.endedAt && <p>Ended: {formatDate(entry.endedAt)}</p>}
                          {entry.errorMessage && <p className="text-red-600 font-medium">Error: {entry.errorMessage}</p>}
                        </div>
                      </details>
                    )}

                    {isTech && entry.kind === 'agentRun' && (
                      <details className="mt-2 group rounded-xl border border-zinc-200 bg-white">
                        <summary className="cursor-pointer p-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 focus:outline-none">
                          <div className="inline-flex items-center gap-2">
                            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-mono border border-zinc-200">AgentRun</span>
                            <span className="text-zinc-900 font-semibold text-xs">{entry.agentName}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${entry.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-700'}`}>
                              {entry.status}
                            </span>
                          </div>
                        </summary>
                        <div className="border-t border-zinc-100 p-3 text-xs text-zinc-600 space-y-1 bg-zinc-50/50">
                          <p>Tokens: <span className="font-mono">{entry.tokens}</span></p>
                          {entry.latencyMs != null && <p>Latency: <span className="font-mono">{entry.latencyMs}ms</span></p>}
                          <p className="font-mono text-zinc-400">execId: {entry.executionId}</p>
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
