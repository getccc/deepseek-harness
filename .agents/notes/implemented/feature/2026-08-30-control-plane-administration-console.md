# Agent Note: The Control Plane administers what its gateways enforce

Status: implemented

English | [中文](2026-08-30-control-plane-administration-console.zh.md)

## Problem

Team Edition already stores accounts, roles, grants, devices, and company models, but those records are not a usable product when administrators must call service methods or inspect SQLite to change them. The first Team Shell pages expose only members, role names, and devices in unstyled tables. Organization identity, the permissions inside a role, member bindings, and the model catalog remain invisible, which makes a deployed RBAC system look absent and encourages out-of-band edits that bypass the same authorization and audit path the product is meant to prove.

## Decision

`dsh-team-shell` owns one server-rendered administration console with persistent navigation for overview, organization, users, roles and access, devices, and models. The console remains script-free and loads no external assets. Forms submit to same-origin server routes, so the existing session, browser-origin, CSRF, access-control, and audit checks remain the only write path; presentation does not introduce a browser API or client-side authorization state.

The shell registers governed control resources for organization, member, role, device, and model-catalog administration. Read and write routes ask distinct code-registered permissions where the action differs. A deployment still bootstraps its first administrator outside the console, then that administrator composes roles from `PERMISSION_CATALOG`, binds and unbinds them on users, and manages organization name, account status, devices, and model catalog entries through audited forms.

The role page reads both type and resource grants. It creates type grants because they are the common organization-wide operation; it can revoke either kind. Resource-specific grant creation remains in the access-control service until the UI has a resource picker that cannot confuse a display name with the governed resource id.

The model page stores only the model gateway's catalog fields. A credential field is a server-side credential reference, never secret material, and a Runner still receives only the stable model reference and display name through discovery.

A credential reference and a credential key address different things, and only the reference resolves when the gateway makes the call. The console and the catalog each refuse a value that is not a reference, so registering one fails where an administrator typed it rather than at the first invocation of a model the catalog reads as active.

An administrative page or action that fails answers as the site's failure. Without that answer the web server's own fallback replies with a bare 400, which tells a signed-in administrator their request was malformed when the site is what could not serve it.

## Alternatives considered

**A separate SPA administration application.** Rejected because it would add a second client bundle, API, and authorization presentation to a surface that works before any application bundle has loaded. The first administration workflows need forms and tables, not a client runtime.

**Styling the existing three pages only.** Rejected because appearance would improve while organization, grants, member-role bindings, and company models remained invisible. The missing information architecture is the product defect.

**Making an administrative role a master key.** Rejected because managing accounts must not imply model invocation or knowledge access. The console displays and edits explicit grants; it does not add permission inheritance outside the existing allow-only union.

**Letting the page accept arbitrary permission strings.** Rejected because the closed catalog is what makes a typo fail where a grant is written. The form submits only catalog pairs and the service validates the pair again.

## Consequences

An administrator can see that RBAC is active, inspect why a role admits work, and manage the Team Edition resources implemented by the current Control Plane without leaving the product. Every write keeps the same audit trail and default-deny evaluation as a non-UI caller.

The console targets the current single-instance, single-organization deployment and renders complete lists without pagination. Account password enrollment, resource-specific grant creation, groups, knowledge catalogs, private artifact catalogs, and production PostgreSQL operation remain separate capabilities rather than decorative placeholders presented as working management pages.
