import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getStepLabel } from '@/lib/dashboard/stepLabel';
import { StateBadge } from '@/components/StateBadge';

export const dynamic = 'force-dynamic';

export default async function AgentTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: { vendor: true },
  });

  if (!workflow) {
    notFound();
  }

  const events = await prisma.agentEvent.findMany({
    where: { workflowId: id },
    orderBy: { sequenceNumber: 'asc' },
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <Link
          href={`/dashboard/workflows/${id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          &larr; Back to Workflow
        </Link>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Agent Timeline</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Deterministic Orchestration Thread for {workflow.vendor.legalName}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-sm font-medium text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
              Step: {getStepLabel(workflow.state)}
            </div>
            <StateBadge state={workflow.state} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-xl border border-zinc-200 text-zinc-500">
            No agent events recorded yet.
          </div>
        ) : (
          <div className="relative border-l-2 border-indigo-200 ml-4 pl-6 py-2 space-y-6">
            {events.map((event) => (
              <div key={event.id} className="relative group bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <div className="absolute -left-[35px] top-6 h-4 w-4 rounded-full border-2 border-indigo-400 bg-white ring-4 ring-zinc-50 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                        #{event.sequenceNumber}
                      </span>
                      <span className="font-semibold text-zinc-900 text-sm">
                        {event.eventType}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        event.status === 'success' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {event.status}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 font-medium">
                      {event.createdAt.toLocaleString()}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {event.agentName && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Agent</span>
                        <div className="font-medium text-zinc-800">{event.agentName}</div>
                      </div>
                    )}
                    {event.workerName && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Worker</span>
                        <div className="font-medium text-zinc-800">{event.workerName}</div>
                      </div>
                    )}
                    {event.toolName && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Tool</span>
                        <div className="font-medium text-zinc-800">{event.toolName}</div>
                      </div>
                    )}
                    {event.latencyMs != null && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Latency</span>
                        <div className="font-medium text-zinc-800">{event.latencyMs}ms</div>
                      </div>
                    )}
                    {event.attemptNumber != null && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Attempt</span>
                        <div className="font-medium text-zinc-800">{event.attemptNumber} {event.maxAttempts ? `of ${event.maxAttempts}` : ''}</div>
                      </div>
                    )}
                    {event.backoffMs != null && event.backoffMs > 0 && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Backoff</span>
                        <div className="font-medium text-zinc-800">{event.backoffMs}ms</div>
                      </div>
                    )}
                    {event.taxonomy && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Taxonomy</span>
                        <div className="font-medium inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded border border-amber-200">{event.taxonomy}</div>
                      </div>
                    )}
                    {event.totalTokens != null && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Usage</span>
                        <div className="font-medium text-zinc-800 text-xs">
                          {event.totalTokens} tokens (P: {event.promptTokens ?? 0}, C: {event.completionTokens ?? 0})
                          {event.promptVersion && <span className="ml-1 text-zinc-400">[{event.promptVersion}]</span>}
                        </div>
                      </div>
                    )}
                    {event.estimatedCost != null && (
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">Est. Cost</span>
                        <div className="font-medium text-emerald-700 text-xs">${event.estimatedCost.toFixed(5)}</div>
                      </div>
                    )}
                    {(event.stateBefore || event.stateAfter) && (
                      <div className="md:col-span-2">
                        <span className="text-zinc-500 text-xs uppercase tracking-wider font-semibold block mb-1">State Transition</span>
                        <div className="flex items-center gap-2 font-mono text-xs bg-zinc-50 border border-zinc-100 rounded px-3 py-2 w-fit">
                          <span className="text-zinc-600">{event.stateBefore || 'N/A'}</span>
                          <span className="text-zinc-400">&rarr;</span>
                          <span className="text-zinc-900 font-bold">{event.stateAfter || 'N/A'}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {event.reasoningSummary ? (
                    <div className="mt-2 text-sm bg-zinc-50/50 border-l-2 border-indigo-300 pl-3 py-1.5 text-zinc-700 italic">
                      {event.reasoningSummary}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm bg-zinc-50/50 border-l-2 border-zinc-200 pl-3 py-1.5 text-zinc-400 italic">
                      No reasoning summary recorded
                    </div>
                  )}

                  {event.error && (
                    <div className="mt-2 text-sm bg-red-50 border border-red-100 rounded-lg p-3 text-red-700 font-mono">
                      Error: {event.error}
                    </div>
                  )}

                  {(event.input || event.output) && (
                    <details className="mt-3 group">
                      <summary className="text-xs font-semibold text-zinc-500 cursor-pointer hover:text-indigo-600 transition-colors list-none flex items-center gap-1.5">
                        <span className="transition-transform group-open:rotate-90">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </span>
                        View Payload Data
                      </summary>
                      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {event.input && (
                          <div className="bg-zinc-900 rounded-lg p-3 overflow-x-auto">
                            <div className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider mb-2">Input Payload</div>
                            <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                              {JSON.stringify(event.input, null, 2)}
                            </pre>
                          </div>
                        )}
                        {event.output && (
                          <div className="bg-zinc-900 rounded-lg p-3 overflow-x-auto">
                            <div className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider mb-2">Output Payload</div>
                            <pre className="text-xs text-emerald-300 font-mono whitespace-pre-wrap">
                              {JSON.stringify(event.output, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
