# Agent Note: Team web search through the Control Plane

Status: implemented

English | [中文](2026-09-15-team-web-search-through-the-control-plane.zh.md)

## Problem

A Team Runner reached company models through the Control Plane, which holds the company credential and decides per member, but its `web_search` tool still ran the base composition's DeepSeek search provider: a Messages call to `api.deepseek.com` with whatever `DEEPSEEK_API_KEY` the member's own computer held. Members without a personal key, which in Team Edition is every member, got a structured `WEB_PROVIDER_CREDENTIAL_MISSING` error the moment they turned web access on, and a member who did hold a key spent it on company work with nothing recorded. The chat composition's [web switch](2026-09-14-chat-preset-without-workspace.md) made the gap visible on the first question that needed current information.

## Decision

**Search is a Control Plane operation; fetch stays local.** [`dsh-web-search-gateway-http`](../../../../packages/web/web-search-gateway-http/README.md) serves `POST /team/web/search` on the Control Plane, where `dsh-web` and `dsh-web-search-deepseek` are composed and the company `DEEPSEEK_API_KEY` credential resolves. [`dsh-web-search-team`](../../../../packages/web/web-search-team/README.md) registers the `team` provider on a Runner's `ctx.web` and sends the query, the source bound, the protocol version, and the current device access token; the Team bundle selects it with `searchProvider: team` and keeps `fetchProvider: http`, because fetching a public page needs no company credential and carrying page bodies through the Control Plane would buy nothing. The route follows the knowledge gateway's shape: the version is decided before any other field is decoded, the principal comes only from the verified token, a refusal is one word from a closed set, and a Runner treats a word it does not know as the Control Plane being unavailable.

**Every search is a decision and a record.** The permission catalog gains `web_search|web.search`; the route registers the organization's one `web_search` resource the first time it serves that organization, asks access control fresh on every call, and writes a `web.search` audit event with the source count, the `no-grant` reason, or the `webFailure` word. The shipped console navigation carries a "Web search" entry of kind `action` under resource management, which is how an administrator gives a role the permission from the role editor; a role that covers the whole catalog holds it from the start, so an existing deployment's administrators are not locked out when they upgrade.

**Failures map to what a member can do.** The Runner provider turns each refusal into the web error code the tool renders: sign in (`WEB_PROVIDER_CREDENTIAL_MISSING`), ask an administrator (`WEB_PROVIDER_ERROR` naming the refusal), retry later (`WEB_PROVIDER_UNAVAILABLE`), update (`WEB_PROVIDER_ERROR`), or nothing (`WEB_ABORTED`). Reachability failures, proxy error pages, and unreadable answers are one fact from the member's seat and share `WEB_PROVIDER_UNAVAILABLE`.

## Alternatives considered

**Sending the search through the model gateway as a second operation.** The DeepSeek search is itself a Messages call, so `/team/model/invoke` could have carried it and inherited quota, audit, and the catalog. Rejected: the transport vocabulary is `chat.completions` only, the usage scanner reads the OpenAI shape, and a search-only model row would appear in every member's model picker unless the catalog schema learned an operation list, which strands every existing `models.sqlite`. The dedicated route reuses the web seam unchanged and leaves the model gateway's security path untouched.

**Deciding `web.search` on the organization resource.** The administration resources already exist per organization, so `organization|web.search` would have needed no registration. Rejected: those resources gate administration, and a member-facing capability on them would let a role editor tick "organization administration" without seeing that it also opens company-paid search.

**No decision, only a valid token.** Every bound member could have searched. Rejected: the Control Plane's rule is that anything it spends a company credential on is decided per member and recorded, as model invocation and knowledge search are; a capability outside that rule is the one an administrator cannot turn off for a role.

**Seeding the resource from the administration API.** `team-admin-api` seeds the other administration resources at startup. Rejected: the web route owns the resource it decides on, as the knowledge gateway owns its catalog resources, and an idempotent registration on first use costs one write per organization per process.

## Consequences

A Team member searches with the company credential from the first `/web on`, and a chat that needs current information gets it without a personal key. Administrators grant or withhold web search per role in the console and see every search, refusal, and provider failure in the audit log. The Control Plane composition gains the web seam and the DeepSeek provider but no fetch provider, and its composition test still proves it carries no code-executing capability. Search usage is not yet reserved or settled against the member's model budget: the DeepSeek route spends a full model request per search on the company key, and the audit log is the only ledger until search joins the quota seam. Standalone `dsh web` deployments are unchanged and keep spending the member's own key.
