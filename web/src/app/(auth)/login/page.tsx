import { googleSignInShown } from '@/lib/data/site'
import { LoginForm } from './login-form'

// Whether to offer Google comes from Admin -> Website and Supabase; refreshed
// within a minute of either changing.
export const revalidate = 60

export default async function LoginPage() {
  return <LoginForm google={await googleSignInShown()} />
}
