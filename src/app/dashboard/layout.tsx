import Link from 'next/link';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="w-64 flex-shrink-0 border-r border-zinc-200 bg-zinc-100">
        <div className="flex h-14 items-center border-b border-zinc-200 px-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <svg
              className="h-5 w-5 text-zinc-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Operations OS
          </Link>
        </div>
        <nav className="p-4 space-y-1 text-sm font-medium">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg bg-zinc-200/60 px-3 py-2 text-zinc-900"
          >
            <svg
              className="h-4 w-4 text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Workflows
          </Link>
        </nav>
      </aside>

      <main className="flex-1">
        <div className="mx-auto max-w-5xl p-8">{children}</div>
      </main>
    </div>
  );
}
