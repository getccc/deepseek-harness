# Agent Note: callers waking to one lapsing token share one refresh

Status: implemented

English | [中文](2026-09-04-callers-waking-to-one-lapsing-token-share-one-refresh.zh.md)

## Problem

A member closed the Welinkin Work desktop application and opened it again later. The reopened browser loaded the model catalog and the knowledge scope at once, and both surfaces failed: `Built-in Models 加载失败：transport failed: refused (control plane refused: reused)` beside the composer, and the knowledge picker refused the same way. Retrying did not help, and neither did waiting; only signing in again restored the Runner.

The word `reused` is the Control Plane's replay verdict: a refresh token is spent by its first presentation, and presenting it a second time revokes the whole credential family, so that a thief and the rightful holder end up equally unable to continue ([device authorization](../../../../packages/account/device-authorization/README.md)). `TeamAccountClient.accessToken()` read the stored credential, judged it about to lapse, and exchanged its refresh token — and it did so once per call. The model transport's catalog request and the knowledge provider's scope request both call it on the first paint after a reconnect, both read the same lapsing credential, and both presented the same refresh token. The first exchange succeeded; the second was the replay, and it revoked the family the first had just rotated. Closing the application for longer than an access token lives made the race certain, because every wake then began with a lapsed token.

## Decision

**One `accessToken()` flight at a time.** The client keeps the promise of the call in progress; a caller arriving while it runs shares it and receives the same token. The flight covers the read as well as the exchange, so a caller that arrives after an exchange completes reads the rotated credential rather than the one it replaced, and there is no window in which a stale read can start a second exchange. The flight clears itself when it settles, whichever way it settles, so a refused exchange does not pin every later call to the refusal.

**Nothing changes on the Control Plane.** Reuse detection keeps revoking the family: it is the property that makes a stolen refresh token worthless, and the Runner was the party presenting one token twice.

## Alternatives considered

**A reuse grace window on the Control Plane.** A refresh token presented again within a few seconds of being spent could answer with the successor already minted, as some authorization servers do. Rejected here: it weakens the replay verdict for every device to cover a Runner defect, and the Runner is one process that can serialize itself. It remains the only cure for a Runner killed between the exchange and its credential write, which this decision leaves as it was.

**Refresh ahead of time from a timer.** A background refresh before expiry would keep the stored token fresh so no wake finds it lapsed. Rejected: the desktop application stops the Runner when it closes, so no timer runs during the stretch that caused the failure, and a timer would still race the first call after a wake.

**Serialize in the two consumers.** The model transport and the knowledge provider could each hold a flight of their own. Rejected: they would still race each other, and a third consumer would race both. The credential is one record, so the seam that owns it owns the flight.

## Consequences

Both surfaces load after a reopen, and a member the race had already revoked signs in once more and stays signed in. Concurrent callers holding a fresh token now share one credential read, which is cheaper than the reads they each made before. The account client's suite drives three simultaneous calls against a real Control Plane with a lead longer than the token's life: all three receive one token, and the next call exchanges the rotated one, which proves the family survived; the same test against the previous client fails with `control plane refused: reused`. A Runner killed between the Control Plane's exchange and its own credential write still presents a spent token on its next start and must sign in again; the grace window above would cover that and is deferred until it is seen.
