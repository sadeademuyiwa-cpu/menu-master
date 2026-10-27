import { HELP_SCREENS } from '@/lib/site/help-videos'
import { pathWords } from '@/lib/usage'

/**
 * A recorded screen in the admin's words (0069): the help-video name when the
 * screen has one ("Record a purchase"), else the route pattern as words. A
 * setup step is added, since setup is one address with several steps.
 */
export function screenName(screen: string | null | undefined, path: string | null | undefined): string {
  const known = HELP_SCREENS.find((s) => s.key === screen)
  if (!known) return pathWords(path)
  const step = path?.startsWith('/start/') ? path.slice('/start/'.length).replace(/[-_]/g, ' ') : ''
  return step ? `${known.label} › ${step}` : known.label
}
