import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalPanel } from '@/components/ApprovalPanel';
import { stateBadgeClass } from '@/lib/dashboard/stateBadge';
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
    <div className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Back to workflows
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{workflow.vendor.legalName}</h1>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Contact email</dt>
                <dd className="text-zinc-800">{workflow.vendor.contactEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Tax ID</dt>
                <dd className="text-zinc-800">{workflow.vendor.taxId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Current step</dt>
                <dd className="text-zinc-800">{getStepLabel(workflow.state)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Chat ID</dt>
                <dd className="font-mono text-xs text-zinc-800">
                  {workflow.chatId ?? 'Not linked'}
                </dd>
              </div>
            </dl>
          </div>
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${stateBadgeClass(workflow.state)}`}
          >
            {workflow.state}
          </span>
        </div>
      </section>

      {pendingApproval && (
        <ApprovalPanel approvalId={pendingApproval.id} step={pendingApproval.step} />
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">Agent Timeline</h2>
        {timeline.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            No activity recorded yet for this workflow.
          </p>
        ) : (
          <ol className="relative space-y-4 border-l border-zinc-200 pl-6">
            {timeline.map((entry, index) => (
              <li key={`${entry.kind}-${entry.ts.toISOString()}-${index}`} className="relative">
                <span className="absolute -left-[1.6rem] top-1.5 h-3 w-3 rounded-full bg-zinc-300 ring-4 ring-zinc-50" />
                <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="font-medium uppercase tracking-wide text-zinc-700">
                      {entry.kind}
                    </span>
                    <span>{formatDate(entry.ts)}</span>
                  </div>

                  {entry.kind === 'message' && (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium text-zinc-700">{entry.direction}</span>
                        {' · '}
                        <span className="text-zinc-600">{entry.role}</span>
                        {' · '}
                        <span className="text-zinc-600">{entry.channel}</span>
                      </p>
                      <p className="whitespace-pre-wrap text-zinc-800">{entry.content}</p>
                    </div>
                  )}

                  {entry.kind === 'audit' && (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium text-zinc-700">{entry.actor}</span>
                        {' · '}
                        <span className="text-zinc-800">{entry.action}</span>
                      </p>
                      {(entry.fromState || entry.toState) && (
                        <p className="text-zinc-600">
                          {entry.fromState ?? '—'} → {entry.toState ?? '—'}
                        </p>
                      )}
                      {formatMetadata(entry.metadata) && (
                        <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-700">
                          {formatMetadata(entry.metadata)}
                        </pre>
                      )}
                    </div>
                  )}

                  {entry.kind === 'execution' && (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium text-zinc-700">Execution</span>
                        {' · '}
                        <span className="text-zinc-600">trigger: {entry.triggerSource}</span>
                      </p>
                      <p className="text-zinc-800">Status: {entry.status}</p>
                      {entry.endedAt && (
                        <p className="text-zinc-600">Ended: {formatDate(entry.endedAt)}</p>
                      )}
                      {entry.errorMessage && (
                        <p className="text-red-600">{entry.errorMessage}</p>
                      )}
                    </div>
                  )}

                  {entry.kind === 'agentRun' && (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium text-zinc-700">{entry.agentName}</span>
                        {' · '}
                        <span className="text-zinc-800">{entry.status}</span>
                      </p>
                      <p className="text-zinc-600">
                        Tokens: {entry.tokens}
                        {entry.latencyMs != null ? ` · Latency: ${entry.latencyMs}ms` : ''}
                      </p>
                      <p className="font-mono text-xs text-zinc-500">
                        execution: {entry.executionId}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
