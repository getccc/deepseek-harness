# Agent Note: The company is a row of the organization tree

Status: implemented

English | [中文](2026-08-31-the-company-is-a-row-of-the-organization-tree.zh.md)

## Problem

The console draws the organization as the first row of the department tree and labels it a company, but the record behind that row held a name and nothing else. A department row opened an edit dialog of eight fields; the company row opened one of a single field. The tree read as one kind of thing and edited as two, and the code, lead, phone, and email columns were permanently empty on the row an administrator looks at first.

Two smaller defects sat on the same page. Every dialog in the console is mounted before it first opens, so Ant Design read `initialValues` once and a dialog reopened for a second record still showed the first one's values. And the page put one field per line with its label above it, which made an eight-field dialog taller than the screen it opens on.

## Decision

`Organization` carries the descriptive fields a `Department` carries: a code, a lead, a phone number, and an email address. `setOrganizationName` is replaced by `updateOrganization`, whose partial-update rules are the ones `updateDepartment` already follows — an absent field is left as stored, a field set to `null` is cleared. Deleting an account clears the company lead it held, as it already cleared the department lead, because the column is a foreign key and would otherwise refuse the delete.

The SQLite backend adds the four columns to the `organization` table and moves `SCHEMA_VERSION` to 4. They are nullable and carry no default, which is what the existing additive path requires of a column added to a table an earlier build created.

`PATCH /organization` takes those fields alongside the name, and `WireOrganization` carries them out with the lead's display name resolved, so the row needs no second request to show who leads the company. The console's page becomes 组织管理 / Organizations, and its name and code columns become 组织名称 / 组织编号: the tree holds companies and departments, and the words on it now say so.

### Two fields to a line

`FormModal` takes a `columns` prop. At `2` it widens the dialog, puts each label beside its control, and lays the form items out as grid cells; a child that needs the whole line asks for it with `form-grid-wide`. The organizations page passes it; every other page keeps the single column it was written for.

### A dialog reopens on the record it was opened for

`FormModal` resets its form as `open` becomes true, which is what puts the record being edited into the fields. `initialValues` is deliberately not a dependency of that effect: callers rebuild it on every render, and resetting on each of them would discard what an administrator is typing.

## Alternatives considered

**Leave the company row renaming-only and say so.** Rejected. The row already claims the same columns as the rows under it; explaining why seven of them are permanently blank costs more than storing them.

**Drop the company row and let a top-level department of category `company` be the root.** Rejected. The organization is what the deployment is configured with and what every account, role, and grant hangs from; making it an ordinary editable tree node would let an administrator delete the tenancy from a table.

**Give the company a parent, category, and order too, for symmetry with a department.** Rejected. It is the root, it is the company, and there is one of it, so all three fields would be controls with one legal value.

## Consequences

An administrator edits the whole tree through one set of fields. The store gained a schema version and a second leadership column to clear on account deletion. The company's code is not checked against department codes: the two live in different tables, and nothing reads either as a key.

The console has no test infrastructure, so the dialog behavior is held by the `team-admin-api` and `account-store-sqlite` tests underneath it and by review of the page itself.
