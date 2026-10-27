/**
 * "We see which screens you use" -- told once to each person, in the app,
 * before any screen of theirs is recorded (0069; the privacy policy promises
 * notice of a change before it takes effect, and NDPA s.27 asks for it at
 * collection).
 *
 * Kept in this browser per signed-in person (localStorage), so a second
 * person on a shared tablet is told too, with an in-memory copy for a
 * browser that will not store it: such a browser tells them again on each
 * visit, and each time recording waits for the telling. Nothing here is
 * sent anywhere.
 */
type State = { shownAt: number; dismissed: boolean }
const keyFor = (uid: string) => `mm-usage-notice-v1:${uid}`
const memory = new Map<string, State>()

function read(uid: string): State | null {
  try {
    const raw = localStorage.getItem(keyFor(uid))
    if (raw) {
      const v = JSON.parse(raw) as Partial<State>
      if (typeof v.shownAt === 'number') return { shownAt: v.shownAt, dismissed: Boolean(v.dismissed) }
    }
  } catch { /* storage blocked: the copy in memory stands */ }
  return memory.get(uid) ?? null
}
function write(uid: string, v: State) {
  memory.set(uid, v)
  try { localStorage.setItem(keyFor(uid), JSON.stringify(v)) } catch { /* this visit only */ }
}

/** Whether the notice still has to be shown to this person (not yet put away). */
export const noticeOpen = (uid: string) => !read(uid)?.dismissed

/** The notice is on this person's screen: from a moment after this, their screens may be recorded. */
export function markNoticeShown(uid: string) {
  if (!read(uid)) write(uid, { shownAt: Date.now(), dismissed: false })
}

export function dismissNotice(uid: string) {
  write(uid, { shownAt: read(uid)?.shownAt ?? Date.now(), dismissed: true })
}

/** Recording waits until the notice has been on this person's screen for a moment. */
export function mayRecord(uid: string, at = Date.now()): boolean {
  const s = read(uid)
  return s !== null && at - s.shownAt >= 1000
}
