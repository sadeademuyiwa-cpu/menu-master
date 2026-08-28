/**
 * Render evidence for the costing journey, in both states, at phone and desktop
 * widths. Requires `next build` and a running `next start -p 3100` against
 * NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321.
 */
import { spawn } from 'node:child_process'

const run = (cmd, args, env) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  p.on('exit', resolve)
})

for (const state of ['complete', 'blocked']) {
  const mock = spawn('node', ['e2e/mock-supabase.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, MOCK_STATE: state === 'blocked' ? 'blocked' : '' },
  })
  await new Promise((r) => setTimeout(r, 1500))
  const code = await run('node', ['e2e/shoot.mjs', state])
  mock.kill()
  if (code !== 0) process.exit(code)
}
console.log('e2e render evidence complete')
