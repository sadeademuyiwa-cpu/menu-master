import { googleSignInShown } from '@/lib/data/site'
import { SignupForm } from './signup-form'

// Whether to offer Google comes from Admin -> Website and Supabase; refreshed
// within a minute of either changing.
export const revalidate = 60

export default async function SignupPage() {
  return <SignupForm google={await googleSignInShown()} />
}
