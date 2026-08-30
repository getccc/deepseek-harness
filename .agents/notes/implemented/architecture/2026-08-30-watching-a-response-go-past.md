# Agent Note: watching a response go past

Status: implemented

English | [中文](2026-08-30-watching-a-response-go-past.zh.md)

## Problem

The gateway decides what a company model call may cost; the endpoint in front of a provider is where it finds out what it actually cost. Those are the same request seen from two sides, and the second side has two constraints the first does not.

A model response is long and often streamed. A Control Plane serves one per member at once, so an endpoint that read the response into memory to inspect it would hold a completion per concurrent request — and would also break streaming, which is the thing that makes an agent feel responsive.

And the settlement rules need the provider's own usage when it is available. That number arrives *inside* the response: in the body of a non-streaming answer, and in one of the last frames of a streamed one. Reading it means watching bytes that are simultaneously being forwarded to a member.

## Decision

**A scanner watches the response go past and keeps one line and one usage object.** Both response shapes go through it: a non-streaming body is one JSON document, and a stream is `data:` frames whose last ones carry the usage. Nothing else is retained, and the response is written to the member as each chunk arrives.

**The newest usage wins.** A stream reports usage in its final frames, and an earlier frame carrying a partial count should not outrank the last word.

**Half a report is not a report.** A usage object with an input count and no output count is refused rather than completed, because charging an invented output alongside a real input would be an estimate wearing a provider's authority.

**What each outcome settles**, following the frozen rules:

| Outcome | Settlement |
|---|---|
| The provider reported usage | `reported`, whatever the status — those tokens were generated |
| A status ≥ 400 with no usage | `released` — the provider said it did not accept the request |
| A success with no usage field | `estimated` at the ceiling — it may still have produced tokens |
| No response at all | `estimated` at the ceiling — no response is not evidence of refusal |

A provider that failed partway and still reported usage is charged what it reported: it generated those tokens, and the status does not unmake them.

**A settlement failure is not the member's problem.** If settling throws, the response the member already received stands and the reconciler closes the reservation later. Throwing there would replace a working answer with an error about bookkeeping.

**The credential exists for one call.** It is resolved at the moment of the request and written nowhere — not into the plan, not into the catalog, not into a log. A catalog entry naming a reference nobody configured, or something that is not a credential reference at all, answers 500 and charges nothing: that is the deployment's problem rather than the member's.

**One answer for every bad token.** Unknown, lapsed, and revoked-device all answer 401, because which it was is exactly what an attacker holding a stale token wants to learn.

## Alternatives considered

**Buffering the response to parse it.** Rejected on both counts: memory per concurrent request, and the loss of streaming, which is the difference between an agent that types and an agent that pauses.

**Asking the provider for usage in a second call.** Rejected: it doubles the requests, and not every provider offers a per-request usage lookup. The number is already in the response.

**Settling from the Runner's report of what it received.** Rejected: the Runner is the party being billed, and a settlement that trusted it would be a settlement it could lower.

**Treating any non-2xx as a release.** Rejected: a provider that generated tokens and then failed reported those tokens, and releasing would make a partial failure free. The status only decides the case where the provider reported nothing.

**Bounding the response by bytes as well as time.** Deferred: a byte limit that cut off a legitimate long completion would be a worse failure than the one it prevents, and the timeout already bounds a provider that never stops.

## Consequences

The endpoint writes no audit record, and the design calls for one on every company model allow and deny. It has the correlation and the device already; adding the record is a small change this one did not make, and it is named in the package's Known Limitations rather than left implied.

`upstreamTimeoutMs` belongs above the longest completion a deployment expects. A request cut off by it is charged its ceiling, because a provider that stopped answering may still have generated tokens — so setting it too low charges members for work they did receive part of.

Not logging a body is not the same as a deployment that cannot log one. The endpoint writes nothing about a request body, but it does not configure the surrounding process, and a deployment that enabled request logging elsewhere would defeat that. The privacy statement in the design distinguishes "not persisted" from "not visible during the request", and this is the seam where that distinction is real.
