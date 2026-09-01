# Agent Note: Editing and deleting a catalog model

Status: implemented

English | [中文](2026-09-01-editing-and-deleting-a-catalog-model.zh.md)

## Problem

The console's model page gave a row one control: retire it, and activate it again. A model registered with the wrong endpoint, the wrong upstream name, or a credential reference that resolves to nothing could only be switched off. Its wrong route stayed in the catalog, and correcting it meant registering a second entry under a second ref — which every grant already written against the first one could not follow. Nothing could take an entry out at all, so a provider an organization stopped using left a permanent row and a permanent governed resource behind it.

## Decision

An edit and a deletion are separate acts, and only one of them is new on the wire.

`POST /models` is the edit. `ModelGateway.register` was already idempotent on `(orgId, modelRef)` and updates the route columns of an entry already stored, so the console's edit dialog is the registration form with the stable ref shown and not editable, submitted to the same address. The status the entry holds is not a route column and an edit leaves it as it was, so correcting a retired model's endpoint does not put it back in service.

`DELETE /models/:ref` is the deletion, and it reaches two new service methods. `ModelGateway.remove` drops the catalog row and then asks access control to stop governing the model; `AccessControl.deleteResource` removes the governed resource together with every grant that named it. Both are silent on a ref or an id nothing holds, the way `setStatus` and `setResourceEnabled` already are. The route records `resource.delete`, the audit action added for it, beside the `resource.register`, `resource.enable`, and `resource.disable` the catalog already wrote.

`remove` ungoverns only what `register` governed, and this is load-bearing. Access control refuses any request whose resource row is absent, and the console's own model-catalog resource — the one `model.catalog.manage` is asked against — is governed under the same `model` resource type without being a catalog entry. The route takes whatever ref its path carries, so a delete addressed to that urn would have revoked the grants admitting every later `model.catalog` request and locked an administrator out of the page with no way back through the console. A ref the catalog holds no entry for now returns before it reaches access control at all.

The row's actions become edit, retire or activate, and delete, each disabled without `model.catalog.manage` and each behind the dialog the other console pages use. The delete dialog says what retiring does not do, because the two controls sit next to each other and the difference is the grants.

## Alternatives considered

**A `PATCH /models/:ref` that carries the route fields.** Rejected. `register` already stores exactly those fields under exactly that identity, and the second write would have to repeat its endpoint and credential-reference checks or accept values the first one refuses.

**Let an edit change the stable model ref.** Rejected. Grants are written against the ref, and a rename would silently move a model out from under every role that names it. Registering a second entry is the honest way to say "this is a different model".

**Delete the catalog row and leave the governed resource.** Rejected, and this is the one that would have been quiet: `registerResource` is idempotent on `(orgId, type, externalRef)`, so a model registered later under the same ref would reuse the surviving resource id and inherit the grants of the model that was deleted.

**Refuse a deletion while any role still names the model.** Rejected. It makes removal depend on which roles happen to hold a grant, sends an administrator to the roles page to hunt them, and buys nothing that retiring does not already buy for an administrator who is not sure.

## Consequences

`deleteResource` sits on the access-control seam rather than in the gateway, so the next subsystem that stops governing something has it. A resource id is not reused: a resource registered again under the same external ref takes a new id and starts with no access, which is the property the deletion depends on.

Deleting is not undoable and takes grants with it; the confirmation dialog is the only thing between an administrator and that. A model an organization means to keep but not serve is what retiring is for.

The console has no test infrastructure, so the page is held by the `team-admin-api` route tests underneath it — the edit that leaves a retired status alone, the deletion that leaves neither a governed resource nor a resource grant, and the delete addressed to the model-catalog resource that leaves an administrator still able to register a model — with the seam's own behavior pinned in `model-gateway-sqlite` and `access-control-sqlite`.
