// ============================================================================
// MENU MASTER NG -- trial reminder mailer, pure logic
//
// Everything here is testable without a network: what each email says, the
// price line, and which rows are fit to send. index.ts does the I/O.
// ============================================================================

export type Kind = "ends_in_3_days" | "ends_tomorrow" | "ended";

/** One row of fn_trial_reminders_due() (0058). */
export type Due = {
  account_id: string;
  kind: Kind;
  owner_email: string | null;
  business_name: string | null;
  trial_ends_at: string;
};

export type Mail = { subject: string; text: string; html: string };

const KINDS: readonly Kind[] = ["ends_in_3_days", "ends_tomorrow", "ended"];

/** A plain address, nothing that could add a second recipient or a header. */
export function sendable(email: string | null | undefined): email is string {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/.test(email);
}

/** Rows fit to send: a known kind and a usable address. At most `cap` per run. */
export function toSend(rows: Due[], cap = 50): Due[] {
  return rows.filter((r) => KINDS.includes(r.kind) && sendable(r.owner_email)).slice(0, cap);
}

/** The date as an owner in Nigeria reads it. */
export function lagosDate(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(iso));
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

/**
 * "Plans start at ₦X a month." From the plans table, founding price while
 * founding places remain -- the same rule /subscribe sells by. Null when no
 * price is known: the email then simply does not quote one.
 */
export function priceLine(
  plans: { price_tier: string; price_kobo: number }[],
  foundingPlacesLeft: number,
): string | null {
  const tier = foundingPlacesLeft > 0 && plans.some((p) => p.price_tier === "founding") ? "founding" : "standard";
  const prices = plans.filter((p) => p.price_tier === tier && p.price_kobo > 0).map((p) => p.price_kobo / 100);
  if (prices.length === 0) return null;
  const from = naira(Math.min(...prices));
  return tier === "founding"
    ? `Founding prices start at ${from} a month while founding places last, and stay at that price for as long as you remain subscribed.`
    : `Plans start at ${from} a month.`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The email for one reminder. The business name is the owner's own words, so
 * it is escaped in the HTML part; nothing else in the email comes from a
 * customer. No figures from their records appear -- only their trial date.
 */
export function reminderEmail(d: Due, siteUrl: string, price: string | null): Mail {
  const name = (d.business_name ?? "").trim() || "your business";
  const when = lagosDate(d.trial_ends_at);
  const plans = `${siteUrl.replace(/\/$/, "")}/subscribe`;

  const subject = d.kind === "ends_in_3_days"
    ? "Your Menu Master free trial ends in 3 days"
    : d.kind === "ends_tomorrow"
    ? "Your Menu Master free trial ends tomorrow"
    : "Your Menu Master free trial has ended — your records are safe";

  const lead = d.kind === "ended"
    ? `The free trial for ${name} ended on ${when}.`
    : `The free trial for ${name} ends on ${when}.`;
  const body = d.kind === "ended"
    ? "Nothing has been deleted. You can still open and read everything you entered. To record new purchases, dishes and sales again, choose a plan."
    : "Everything you have entered stays yours. To keep recording purchases, dishes and sales after that date, choose a plan.";
  const button = d.kind === "ended" ? "Choose a plan" : "See the plans";
  const footer = "You are getting this because you created a Menu Master account with this email address. " +
    "Payment is handled by Paystack; you can cancel at any time.";

  const text = [
    "Hello,", "", lead, "", body, ...(price ? ["", price] : []), "",
    `${button}: ${plans}`, "", "— Menu Master NG", "", footer,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#171b18">
<p style="font-size:18px;font-weight:bold;margin:0 0 16px">Menu Master NG</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${esc(lead)}</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(body)}</p>
${price ? `<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${esc(price)}</p>` : ""}
<p style="margin:0 0 24px"><a href="${esc(plans)}" style="display:inline-block;background:#1f7a52;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:#66706a;margin:0">${esc(footer)}</p>
</div>`;

  return { subject, text, html };
}

/** The body Resend expects. */
export function resendBody(from: string, to: string, mail: Mail, replyTo?: string) {
  return {
    from, to: [to], subject: mail.subject, text: mail.text, html: mail.html,
    ...(replyTo && sendable(replyTo) ? { reply_to: replyTo } : {}),
  };
}

/** One send per account and kind, even if the run is repeated (Resend keeps it 24 h). */
export function idempotencyKey(d: Due): string {
  return `trial-${d.account_id}-${d.kind}`;
}
