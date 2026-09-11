---
description: "The /knowledge picker and composer chip for the Web GUI: choosing which private knowledge bases a conversation may search; for members using private knowledge and its maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge

English | [中文](README.zh.md)

## Summary

This package is how a member chooses what a conversation may search: the composer's knowledge control and the `/knowledge` command both list the knowledge bases their roles authorize, and each tick applies at once. The choice is a Session event, so the composer chip, the model's prompt section, and a replay all read the same fact. Nothing is chosen by default — a new conversation searches no private knowledge until someone says otherwise — and a build without private knowledge does not mount this plugin at all.

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

Mount this plugin in a Team composition, alongside `api-knowledge-controller` on the Host; the `/knowledge` command then appears in the composer's command menu and the chip in its tool row. The Team bundle mounts both.

### Choosing knowledge

There are two ways in, and they write the same thing. The composer's knowledge control opens a menu of the same rows; typing `/knowledge` opens the picker, which adds a search box for a long directory. Either way a tick applies immediately and the list stays open, so choosing three knowledge bases is three clicks and no confirmation. Unticking the last one turns private knowledge off, which is also where every conversation starts.

The first row, **All authorized knowledge bases**, cannot be ticked beside individual ones: it means whatever the member's roles authorize at the moment of each search, including bases granted later, while a named selection means exactly those bases. The rest of the rows are the directory as the Control Plane answers it right now, so a revoked grant leaves the picker without rewriting what the conversation already recorded.

### When a chosen knowledge base goes away

A selected knowledge base the directory no longer holds is still listed in the `/knowledge` picker, unticked, and marked as no longer available. Unticking it drops it — an explicit act by the member, never a silent shrink. Until then the recorded choice stands and a search naming it fails rather than quietly returning less.

### The composer control

The control reads the conversation's scope: it says `Knowledge` in the composer's own ink while nothing is chosen, and the chosen names in the business tint once something is. Clicking it opens the same choice the command does.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin mounts the Team-only `knowledge` Remote namespace itself, rather than through the shared Client assembly, because only a Team Host serves it — a build without private knowledge would otherwise grow a namespace whose every call fails. The mount is an effect like every other contribution, and the two surfaces park on `remote.knowledge`, the service it provides, so neither exists before the namespace it calls and both are gone before it is. `src/client/scope.ts` owns the whole mapping between clicks and recorded scope: `optionsOf` draws the picker's rows from `knowledge.scope`, `choiceOf` reads a ticked set as `off`, `all`, or a named selection, and `toggleScope` does the same for one menu row against the choice in force. `knowledge.choose` records the result. The `/knowledge` command is a `popupMultiSelect` contribution on `ctx.commandUi`, whose exclusive first row is the shell mechanism behind the whole-set choice; the composer control occupies the `conversation.input.left` zone and reads the host-computed `knowledge` projection through the standard-kit `useProjection`, so neither surface holds a copy of the choice. A menu click reads the scope from the same directory answer it acts on rather than from a projection it may not have seen yet. Failure lines stay English by the error-surface policy, and carry the Remote's own code.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the picker is not enough. They move from the surface to the knowledge the member is choosing among.

- [dsh-tool-knowledge](../../knowledge/tool-knowledge/README.md) — the search tool, the prompt section, and the projection this chip reads.
- [dsh-api-knowledge-controller](../../api/knowledge-controller/README.md) — the Remote namespace serving the authorized directory and recording the choice.
- [ui-commands](../ui-commands/README.md) — owns the multi-choice popup shell and the command surface this contribution registers into.
- [Knowledge package map](../../knowledge/README.md) — the seam from the picker to the upstream knowledge source.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `knowledge/scope` event the picker writes: `dsh-tool-knowledge` turns that event into the prompt section naming the chosen knowledge bases, and into whether the `knowledge_search` tool exists at all. No text from this package reaches a request.

#### KV Cache effect

Each applied tick changes the `knowledge:scope` system-prompt section and whether the search tool is registered, so the next request's prefix differs from the last one and the provider prefix is invalidated from that section onward. Opening either surface costs nothing until something is clicked.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current picker. They are current package constraints, not a knowledge-product comparison or a task backlog.

- **The choice lives in one conversation** — there is no remembered default across conversations, so every new conversation starts with private knowledge off.
- **The picker takes no query** — `/knowledge` only chooses scope; searching is the model's through `knowledge_search`.
- **The menu has no search** — the composer control lists the directory as it comes; `/knowledge` is where a long directory is filtered.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: a command contribution and a composer seat whose disposal is proven by the HMR-safety spec both read the Session's knowledge scope through the Host, emit no cordis events, and own no cross-plugin mutable state.
