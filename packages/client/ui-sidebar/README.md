---
description: "Sidebar shell plugin for the dsh web client: brand row, New chat and New work task entries, collapse control, scroll-aware region seats, and bottom-pinned Settings seat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

The dsh web client sidebar lets users recognize the active build, start a new chat or work task, collapse navigation to a 56px rail, browse Workspaces, Sessions, and recent conversations, and open Settings. It keeps a bottom-pinned Settings entry and hides idle scrollbars without moving browser rows. New chat opens a Session without a Workspace; New work task uses an explicitly selected Workspace, then the current Session's Workspace, then the most recently active one, and with none it opens a blank New Session page. Deployments can replace the brand mark or name while retaining the navigation controls and rail geometry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The sidebar is the navigation shell. Users see the brand, start new chats and work tasks, collapse the rail, and reach Settings. ui-workspace fills `sidebar.workspaces` and `sidebar.recent`, and ui-settings registers the trigger row and panel at `sidebar.settings`. The outer viewport scrolls the panel navigation away first. Workspace rows and the Recent list then scroll below the docked Workspace toolbar. Recent has its own heading and filter. Scrolling up returns the shared list to the top before bringing back the panel navigation.

### Brand, New chat, and New work task

The expanded brand row renders `sidebar.brand.mark` and `sidebar.brand.name` as independent single slots. The collapsed rail renders the same mark slot. On Web and Windows desktop, clicking the expanded brand starts a work task. The slots default to the WeWork logo and name in every locale. New work task appears before New chat. **New chat** starts a conversation without a Workspace through `uiWorkspace.startChat()`. **New work task** uses the Workspace from a scoped action, the current Session, or the most recently active Workspace, in that order. With no Workspace, it opens the blank New Session page. The brand shortcut, the New work task row, and the macOS titlebar control expose the effective New Session binding through `aria-keyshortcuts`. The rail and macOS titlebar tooltips show the binding as platform-formatted keycaps.

### Global panel entries

Plugins add an icon component to the root-scoped `sidebar.panellist` list with an `id`, optional `order`, and a string or locale-aware `label`. The same id addresses the component registered in the layout's root-scoped `main` keyed slot; selecting a missing main entry throws without changing the current selection. The label supplies plain visible text, the accessible name, and the collapsed tooltip. Expanded navigation rows are 32px high with a 2px gap, including between the new Session controls and the first panel; collapsed rail controls remain 36px high with a 12px gap. Each row reads its own selected state through `usePanelInfo`; moving DOM focus to search or a directory picker does not change the displayed panel or its selected row. With no panel registrations, neither the list nor spacing for it is rendered. The shipped composition registers no example panel.

While the root-scoped `sidebar.panellist.actions` list has registrations, a **More** button styled as a panel row follows the rows inside the navigation landmark; the collapsed rail shows its label as a tooltip. It opens a menu beside the sidebar, with viewport-aware placement, whose rows are that list's registrations. Each receives `entries` (customizable panels in registration order with `id`, `label`, `pinned`, and `active`; Plugins is never listed), `onOpen(id)`, which selects the panel, `onPinnedChange(id, pinned)`, and `onDismiss()`, which closes the menu. The sidebar keeps one in-memory list of unpinned panel ids shared by every Session; Plugins always shows. While More shows, expanded rows other than Plugins show an unpin action on hover or keyboard focus; devices without hover show it continuously. Its resting color matches the Session pin marker, and its tooltip says “Unpin from left sidebar”. Both sidebar and More entries follow the same registration order rather than pin timing. The default More menu lists only unpinned panels before plugin browsing and creation; opening a panel does not pin it, while its separate pin icon returns the row to the sidebar and dismisses the menu. Choices reset when the plugin reloads and legacy localStorage values are ignored. Unpinning hides only the row, and only while More shows; without `sidebar.panellist.actions` registrations every registered row shows again. The main panel, its registration, and the current selection stay unchanged. Unregistered panel ids remain in the in-memory list until the plugin reloads.

### Collapse behavior

The sidebar and conversation-header toggles show the effective shortcut from the command catalog in their hover and keyboard-focus tooltips and `aria-keyshortcuts`. An unbound command shows only the action label.

The top expand button hosts the optional, non-interactive `sidebar.toggle.badge` slot while collapsed. Its occupant supplies status and tooltip content without adding another action or changing the button's navigation behavior.

Expanded content follows the frame's column width, including its transitions. During a live collapse, the content fades out at its frozen expanded width, the upper controls share one fade and leftward translation into the 56px rail, and the layout's column slide ends the motion. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation.

On Windows Electron, `html[data-windows-titlebar]` fixes the sidebar toggle in the caption's top-left corner in both states. The expanded brand sits below the caption, above the New chat and New work task entries. Collapsing hides the brand and all sidebar content, leaving the toggle in the caption. The sidebar sets the root `--dsh-windows-menu-start` to 84px when collapsed; the Desktop preload uses it to position its menu and defaults to 48px when expanded. Caption icon buttons use centered 16px glyphs in 28px controls with the compact control radius and exclude themselves from the window drag region. The sidebar toggle's bubble opens below the caption, where the Desktop-owned menu text cannot cover it; an occupying `sidebar.toggle.badge` chooses its own bubble side.

### macOS desktop

Under `html[data-platform='darwin']` (set only by the desktop preload) the expanded column opens with a 52px top strip that clears the hiddenInset traffic lights and carries the collapse toggle; the strip and the logo row below each mark themselves `data-window-drag`, so each row's own box is the window's drag region (ui-web base.css declares the one darwin drag rule), and the brand wordmark is not a New work task shortcut there — the New work task entry keeps the action — and collapsing hides the column entirely instead of leaving the rail. The package registers `HeaderLeadingControls` into the frame's `shell.leading` window-chrome seat (ui-layout), which mounts it — the open-sidebar, New chat, and New work task controls beside the traffic lights — only while the column is hidden, over every main panel. The [Desktop reference](../../../apps/desktop/README.md) owns window integration.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The section scroller keeps its gutter reserved so revealing the thumb does not move rows.

### Click analytics

On Desktop, the official navigation controls report `sidebar_menu_click` with `menu_name` and `position` before they act. Without the analytics service, the controls only navigate. Selecting a panel by other means reports nothing, and the sidebar reports no exposure events.

- The expanded brand and the New work task entry report `menu_name=new_session` with `position=sidebar`. While the Windows caption hosts the collapsed New work task entry, that entry reports `position=titlebar`; the macOS New work task control beside the traffic lights also reports `position=titlebar`. New chat reports nothing.
- The **Plugins** and **Automation tasks** rows report `menu_name=plugin` and `menu_name=cron` with `position=sidebar`. Other panel rows report nothing.
- Each **More** button click reports `menu_name=more` with `position=sidebar`, whether it opens or closes the menu.
- A More menu row that calls `onOpen(id)` for Plugins or Automation tasks reports `menu_name=plugin` or `menu_name=cron` with `position=sidebar_more`. The shipped More menu calls `onOpen` for unpinned panels, including Automation tasks; pin and unpin actions report no navigation click. The report precedes the registration check, so a request for a panel that has unregistered still counts although nothing is selected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared brand, the `sidebar.workspaces`, `sidebar.recent`, and `sidebar.settings` child slots, and injected navigation callbacks. The sidebar owns `sidebar.panellist` and renders each panel's registered icon directly. Panel metadata is derived from list registrations and locale changes; selection belongs to the layout store. The injected `trackEntryClick(attributes)` forwards to `ctx.get('productAnalytics')?.track('sidebar_menu_click', attributes)`, and `selectPanel` only selects, so each control supplies its own entry and position.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`). The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

A `sidebar.workspaces` occupant can attach the optional `bindRecentOutlet` ref to an element after its rows. The sidebar mounts `sidebar.recent` there while the outlet exists. Without an outlet the sidebar mounts Recent after the workspace slot in the outer viewport.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — the Workspace and Session browser rendered into `sidebar.workspaces`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the layout owner whose rail and column state the collapse uses.
- [ui-theme](../ui-theme/README.md) — the scrollbar token indirection the shell rebinds.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-workspace** — no done/error notification sources are available to this shell.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to ui-workspace, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
- **Only wheel and trackpad input crosses the navigation boundary in one gesture** — touch drags keep native nested scrolling and stop where the viewport reaches its end; browsers without scroll-state container queries scroll the section first. Wheel steps split in JavaScript run on the main thread without smooth-scrolling animation or overscroll bounce.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
