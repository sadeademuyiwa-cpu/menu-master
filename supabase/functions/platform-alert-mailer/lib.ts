// ============================================================================
// MENU MASTER NG -- platform alert mailer, pure logic
//
// Everything here is testable without a network: which rows to send, what
// the email says, and what to stamp afterwards. index.ts does the I/O.
// ============================================================================

export type Alert = {
  id: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  subject: string;
  summary: string;
  detail: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  notified_at: string | null;
};

/** Only open rows nobody has been told about, most severe first, oldest first. */
export function toNotify(rows: Alert[]): Alert[] {
  const rank = { critical: 0, warn: 1, info: 2 } as const;
  return rows
    .filter((r) => r.resolved_at === null && r.notified_at === null)
    .sort((a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.first_seen.localeCompare(b.first_seen)
    );
}

/** What the caller must present. Constant-time-ish: compares full length always. */
export function tokenMatches(presented: string | null, expected: string | undefined): boolean {
  if (!presented || !expected || expected.length < 16) return false;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const KIND_WORDS: Record<string, string> = {
  billing_failed_permanent: "Billing event failed permanently",
  billing_stuck: "Billing event stuck",
  founder_slots_low: "Founding slots running low",
  founder_slots_exhausted: "Founding slots exhausted",
  past_due_beyond_grace: "Subscription past due beyond grace",
  subscription_no_period: "Subscription without a period end",
};

export function kindWords(kind: string): string {
  return KIND_WORDS[kind] ?? kind.replace(/_/g, " ");
}

/**
 * One digest per run. Plain text -- it is read on a phone, and nothing in it
 * needs formatting. No payloads, no card data, no customer entries: the rows
 * only ever carry what fn_admin_scan put in `detail` (ids, codes, dates).
 */
export function digest(rows: Alert[], adminUrl: string, now = new Date()): { subject: string; text: string } {
  const critical = rows.filter((r) => r.severity === "critical").length;
  const subject = critical > 0
    ? `[Menu Master] ${critical} critical, ${rows.length} open alert${rows.length === 1 ? "" : "s"}`
    : `[Menu Master] ${rows.length} open alert${rows.length === 1 ? "" : "s"}`;

  const lines: string[] = [];
  lines.push(`Menu Master NG noticed the following at ${now.toISOString()}.`);
  lines.push("");
  for (const r of rows) {
    lines.push(`${r.severity.toUpperCase()}  ${kindWords(r.kind)}`);
    lines.push(`  ${r.summary}`);
    lines.push(`  first seen ${r.first_seen}  ·  subject ${r.subject}`);
    const facts = Object.entries(r.detail ?? {})
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`);
    if (facts.length) lines.push(`  ${facts.join("  ")}`);
    lines.push("");
  }
  lines.push(`Open the admin page to resolve: ${adminUrl}`);
  return { subject, text: lines.join("\n") };
}

/** The body Resend expects. */
export function resendBody(from: string, to: string, mail: { subject: string; text: string }) {
  return { from, to: [to], subject: mail.subject, text: mail.text };
}

/** Fixed error codes to the caller; never the provider's prose. */
export function safeError(code: string) {
  return { error: code };
}
