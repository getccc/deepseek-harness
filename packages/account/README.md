---
description: "Package map for the account capability family: the backend-neutral store that holds organizations and member accounts, and the SQLite backend that persists them."
kind: "package-group"
---

# account/ — who a member is

English | [中文](README.zh.md)

## Summary

The `account/` group holds the identities Team Edition authorizes: one organization and the member accounts inside it, each with a login name, a status, and the sign-in state a lockout policy reads. The store is a repository and nothing more — it records what happened and reports conflicts, while the policy that decides what a failure count means, and the format of any authentication material, belong to the authentication provider that reads and writes through it. Splitting storage from authentication method is what lets an external identity provider replace sign-in later without touching stored accounts, roles, or devices.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Four packages cover the family; each child README owns the full contract.

| Package | Role | ctx key |
|---|---|---|
| [`account-store/`](account-store/README.md) | Service Definition: organizations, member accounts, and sign-in state | `ctx.accountStore` |
| [`account-store-sqlite/`](account-store-sqlite/README.md) | Stores them in one SQLite database file | registers `ctx.accountStore` |
| [`account-auth/`](account-auth/README.md) | Service Definition: turn a login name and a secret into an account | `ctx.accountAuth` |
| [`account-auth-password/`](account-auth-password/README.md) | Verifies against a stored hash and owns the lockout policy | registers `ctx.accountAuth` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Account subsystem](../../docs/subsystems/account.md) — the identity model, the credential format, and how a sign-in is answered.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.
- [`team-control-plane/`](../bundle/team-control-plane/README.md) — the server profile these packages are composed into.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Authentication lives in its own family rather than here, so replacing the sign-in method never migrates stored identity.

</details>
