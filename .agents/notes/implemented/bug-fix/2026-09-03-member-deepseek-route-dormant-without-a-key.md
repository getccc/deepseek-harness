# Agent Note: the member DeepSeek route stays dormant without a key

Status: implemented

English | [中文](2026-09-03-member-deepseek-route-dormant-without-a-key.zh.md)

## Problem

A member signed in to the Team Runner without a DeepSeek key of their own opened the model menu and saw a `DeepSeek` group listing three models above the company's `Built-in Models`. None of the three could serve a request: `llm-deepseek` registered `deepseek-official` at load whatever its credential reference held, and only the request itself discovered the missing key and failed with `MISSING_CREDENTIAL`. The [request-level configuration decision](../architecture/2026-07-29-request-level-llm-config-credentials.md) chose that posture so a missing key would never fail plugin load, and the [route split](2026-09-01-separate-company-and-member-model-routes.md) then put the company catalog under its own route — which left the member route advertising models a keyless member could pick, fail with, and not understand.

The standalone Web app had the same posture for a different reason: its first-run key prompt read the declared `deepseek-official` route as inactive whenever it was not registered, and treated inactivity as a deployment fault that ends onboarding without rendering. A route that registers only once a key exists would therefore have hidden the very prompt that stores the key.

## Decision

**`deepseek-official` is registered only while its credential reference resolves.** `llm-deepseek` still declares the route as configurable at load, so the Models card and the first-run prompt keep their entry point, and it still resolves the key per request. Registration, though, follows the same reference the request reads: with the credentials seam mounted, `describe(ref).configured` decides; without it, the launching environment decides once at load, because process-environment changes are not observable. The plugin re-judges the route on every `credentials/reference-updated` commit for that reference, on a settings change (the section may rename the reference or the retry policy), and when the credentials seam attaches or detaches. The `built-in` route follows the mounted transport alone, exactly as before: its credential lives on the Control Plane.

**The route set joins the retry policy as a registration-captured fact.** Both re-register in place through `replace`, in one synchronous registry section, so an observer never sees the provider disappear and come back. The registry refuses an empty first registration, so a dormant plugin holds none until some route is on; a later empty set keeps a live registration through the dormant stretch rather than disposing it. Credential lookups are asynchronous and may overlap: a generation counter lets the latest one own the registry, and none of them touches it once the fiber is unloading, disposed, or failed. Plugin load awaits the first lookup, so a request issued right after the plugin's own `await` never lands in an unregistered window.

**A dormant declared route fails a request with directions.** `NO_ADAPTER` keeps its code and its `no adapter registered for provider "…"` prefix, and when the configurable-provider directory declares the route the message names the settings section that activates it and says the web Models page writes both the section and its credential. A headless run without a key therefore still learns what to do, which `MISSING_CREDENTIAL` used to tell it.

**First-run readiness reads a dormant official route as the keyless posture, not a fault.** `onboardingReadiness` no longer has a `provider-inactive` reason: the declared row's credential descriptor decides. An unconfigured writable credential prompts as before; a configured credential on a route the registry has not picked up yet is a registration in flight and reads as `loading`, which the `llm/adapters-updated` refresh turns provider-ready. The [first-run credential setup decision](../feature/2026-07-30-deepseek-onboarding-credential-setup.md) records the amended list of states that end the step without rendering.

## Consequences

The Team Runner's model menu offers a member exactly what can serve them: the company's `Built-in Models`, plus a `DeepSeek` group only after the member stores a key of their own, and the Team profile's `built-in` default needs no fallback for the common case. The standalone Web app's composer is inert with the model-unavailable block while no route exists, and the first-run prompt opens beside it; storing the key registers the route on the same commit, so the block lifts and the prompt closes without a reload. Removing the key drops the route again, and a Session that had selected it goes unroutable rather than failing its next request.

An ambient-only key is judged once, at load. A key exported into the process environment after boot activates the route only on the next settings change or seam attach; the managed credential store — what the Models page writes — is the live path. `MISSING_CREDENTIAL` remains reachable for a request whose key vanished between registration and the call, and the adapter class embedded without the plugin keeps that failure as its only keyless signal.

No keyless recorded-session scenario pins the dormant posture: every snapshot lane disables `llm-deepseek` and serves `deepseek-official` through `dsh-llm-replay`, so the picker's contents under a real keyless adapter cannot be recorded there. The plugin's own tests pin registration on key arrival, removal, reference rename, seam attach and detach, a failed lookup, overlapping lookups, and a lookup settling after unload; the client tests pin the amended readiness states and the dialog's open-then-wait sequence.

## Alternatives considered

**Keep the route registered and filter the catalog instead.** Rejected: `session/modelCatalog` builds its groups from `listProviders()` and reports the same set as `routableProviders`, the fact the composer block reads. Hiding a registered route from one projection while another calls it routable would let a member select through `/model` what the menu hides, and would need a second notion of "configured" beside the registry's. Registration already means "can serve a request"; a keyless route does not.

**A registry-level `providerReady` query answered by each adapter.** Rejected: it adds a seam role and an asynchronous question every catalog read must await, to express a fact the registry already models as membership. The pi-ai adapter set the precedent — a bare mount registers nothing until a settings section supplies profiles — and the member route is the same posture keyed on a credential rather than a profile.

**Log a warning at load when the plugin holds no route.** Rejected: in the Team Runner a dormant member route is the ordinary state on every boot, and keyless CLI smokes expect an empty stderr. The `NO_ADAPTER` message carries the directions to the one place a keyless request actually surfaces.

**Keep `provider-inactive` and special-case the official route in the dialog.** Rejected: after this change the official route is inactive exactly when its key is absent or its registration is in flight, so the reason no longer names a deployment fault the Models page could diagnose. Two readers of one join must not disagree about what inactive means.
