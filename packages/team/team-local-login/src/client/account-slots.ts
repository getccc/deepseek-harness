/**
 * The member row's declared hole and the share its occupants receive. The
 * declaration lives beside the row rather than inside its component file, so
 * a consumer that imports this package's browser entry pulls the slot into
 * its own program.
 * @module @deepseek-ai/dsh-team-local-login/client/account-slots
 */

// Type-only: the map this module extends.
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Actions rendered beside the member row at the sidebar foot, inside the
     * row `TeamAccountLauncher` lays out. An occupant receives the column
     * state and nothing else, because the row holds no state of its own.
     */
    'team.account.action': { kind: 'list'; scope: 'root'; owner: TeamAccountActionOwnerProps }
  }
}

/** Owner share of an action rendered beside the member row. */
export interface TeamAccountActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}
