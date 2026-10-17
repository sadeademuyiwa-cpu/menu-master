/**
 * Who may make or change a size, and its packaging: owner and manager. The
 * INSERT and UPDATE policies on serving_formats and serving_format_packaging
 * admit only those two (p_serving_formats_*, p_sfp_*).
 *
 * A COURTESY, never the check: RLS refuses anyone else whatever this says. It
 * exists so a kitchen, sales or accountant member reading Sizes is not shown
 * an "Add a size" form that can only fail.
 */
export const SIZE_ROLES = ['owner', 'manager'] as const

export function canChangeSizes(role: string | null | undefined): boolean {
  return (SIZE_ROLES as readonly string[]).includes(role ?? '')
}
