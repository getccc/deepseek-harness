/** The Runner-local member sign-in path. */
export const LOGIN_PATH = '/team/login'
/** The stable Runner entry path used at application launch. */
export const OPEN_PATH = '/team/open'
/** The Runner-local sign-out path. */
export const LOGOUT_PATH = '/team/logout'
/** Same-origin account identity read by the unlocked Team client. */
export const ACCOUNT_PATH = '/team/account'
/**
 * Query parameter the sign-in redirect carries into the application.
 *
 * A member who has just signed in gets an empty conversation rather than
 * whatever the browser was last looking at: the selection is persisted per
 * browser while the conversations belong to this computer, so without it the
 * next member to sign in lands inside the previous member's conversation.
 * The client consumes the parameter and removes it from the address, so a
 * later reload keeps whatever that member has opened since.
 */
export const SIGNED_IN_PARAM = 'signed-in'
