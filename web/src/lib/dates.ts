/**
 * "Today", as the owner's calendar says it.
 *
 * Kept free of React and Next so it is tested directly.
 *
 * WHY THIS EXISTS
 *   Dates were defaulted with new Date().toISOString().slice(0, 10), which is
 *   the date in UTC. Lagos is UTC+1, so between midnight and 1 am every new
 *   sale and purchase was dated yesterday, and "Sold today" looked for the
 *   wrong day.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Lagos'

/** YYYY-MM-DD in the business's time zone. */
export function localToday(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}
