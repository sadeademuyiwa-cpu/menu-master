/**
 * Does this click mean "take me to another page in this app"?
 *
 * The progress bar starts on a navigation and completes when the URL changes.
 * Starting it for a click that opens a new tab, downloads a file, leaves the
 * site or only moves within the page would leave a bar stuck at 85% with
 * nothing coming. Pure, so the rule can be tested without a browser.
 */
export type ClickFacts = {
  href: string | null
  target: string | null
  download: boolean
  button: number
  modifier: boolean
  /** window.location.origin */
  origin: string
  /** window.location.pathname + search -- so a same-page hash link is skipped */
  current: string
}

export function isInternalNavigation(c: ClickFacts): boolean {
  if (!c.href) return false
  if (c.button !== 0 || c.modifier || c.download) return false
  if (c.target && c.target !== '_self') return false

  let url: URL
  try { url = new URL(c.href, c.origin) } catch { return false }
  if (url.origin !== c.origin) return false
  if (!/^https?:$/.test(url.protocol)) return false

  // A link to where we already are, with only a hash, moves within the page.
  const dest = url.pathname + url.search
  if (dest === c.current && url.hash) return false
  return true
}
