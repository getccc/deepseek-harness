import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-team-local-login',
  ['lib/types/index.js'],
  { hostPhase: true },
)
