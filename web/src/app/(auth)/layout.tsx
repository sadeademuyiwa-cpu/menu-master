export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Menu Master NG</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
          Know your cost. Know your price. Know your profit.
        </p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  )
}
