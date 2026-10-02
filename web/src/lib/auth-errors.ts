/**
 * What to tell someone when signing in, signing up or resetting a password
 * goes wrong.
 *
 * Kept free of React and Supabase so it is tested directly. Supabase's own
 * messages ("Invalid login credentials", "Email not confirmed") were shown
 * as they came; owners read the second as "my account is broken" and left.
 * Each case now says what to do next. The code is preferred; the message is
 * the fallback for older servers that send none.
 */
export type AuthProblem = {
  /** One plain sentence. */
  text: string
  /** The account exists but its email is not confirmed: offer to resend. */
  canResend?: boolean
  /** Nothing is wrong with the request itself: try again shortly. */
  transient?: boolean
}

export function friendlyAuthError(err: { code?: string | null; message?: string | null; status?: number | null }): AuthProblem {
  const code = err.code ?? ''
  const msg = (err.message ?? '').toLowerCase()

  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return {
      text: 'Your email is not confirmed yet. Open the link we sent you — check Spam or Promotions if you cannot find it — or send it again.',
      canResend: true,
    }
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return { text: 'That email and password do not match. Check them, or reset your password.' }
  }
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) {
    return { text: 'This email already has an account. Log in, or reset your password.' }
  }
  if (code === 'same_password' || msg.includes('should be different')) {
    return { text: 'That is your current password. Choose a new one.' }
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return { text: 'Choose a longer password — at least 8 characters.' }
  }
  if (code.startsWith('over_') || err.status === 429 || msg.includes('rate limit') || msg.includes('only request this after')) {
    return { text: 'Too many tries in a short time. Wait a minute, then try again.', transient: true }
  }
  if (msg.includes('fetch') || msg.includes('network')) {
    return { text: 'We could not reach Menu Master. Check your connection and try again.', transient: true }
  }
  return { text: 'Something went wrong. Please try again.' }
}
