# Grill Tab desktop development

`desktop/plugin.js` is an uncompiled, single-file ESM desktop plugin. Its imports are restricted to `@hermes/plugin-sdk` and `react/jsx-runtime`. The testable core lives between `// @core-start` and `// @core-end`; run `node scripts/extract-core.mjs` after changing that section to regenerate `desktop/grill-core.mjs` for Node tests.

## Composer DOM adapter selectors

The `composerAdapter` object in `plugin.js` is the only plugin code permitted to touch Hermes app DOM. Selectors are intentionally scoped to the live composer root and documented below.

| Selector | Why it is used | Production provenance |
| --- | --- | --- |
| `[data-slot="composer-root"]:has([data-slot="composer-surface"])` | Selects the live composer root and excludes the fallback root, which has no surface marker. | `apps/desktop/src/app/chat/composer/index.tsx:1243-1277`, fallback at `:1438-1457` |
| `[data-slot="composer-surface"] [data-slot="composer-rich-input"][role="textbox"]` | Selects the visible rich contenteditable composer input. The adapter reads it, focuses it, writes it, and checks the Tab target here. | `rich-editor.ts:22`; `index.tsx:1053-1113` |
| `[data-slot="composer-surface"] textarea:not([aria-hidden])` | Compatibility path for a visible textarea renderer. It excludes the hidden assistant-ui binding textarea. | visible editor contract `index.tsx:1053-1113`; hidden textarea `:1130-1140` |
| `[data-slot="composer-completion-drawer"][data-state="open"][role="listbox"]` | Completion-open test. It covers slash, `@`, and emoji trigger drawers so bare Tab is never taken from completion navigation. | `apps/desktop/src/app/chat/composer/trigger-popover.tsx:154-162`; mounted by `index.tsx:1280-1289` |

### Adapter behavior

- `writeDraft(text)` uses the native `HTMLTextAreaElement.prototype.value` setter, then dispatches bubbling `input`; for the production contenteditable it writes text content then emits the same event.
- The DOM listener is document capture phase, but claims bare Tab only for an idle, non-empty composer rich input with no completion drawer. All other Tab behavior is untouched.
- Every document listener is removed by `ctx.onDispose`.

## Manual verification / smoke checklist

1. Install the file at `~/.hermes/desktop-plugins/grill-tab/plugin.js`, then run **Reload desktop plugins** in Hermes Desktop.
2. Confirm no plugin-load error toast and the ladder strip is above the input, inside the composer box.
3. Check the exact visual contract: one 12 px left/right inset; 20 px rung number column; 8 px vertical rhythm; no hard colors/backgrounds; rung questions single-line; answers right-aligned/truncated; answer hairline becomes accent on focus.
4. Type `/` and open slash completion; Tab must select/continue the completion and never open Grill Tab. Repeat with `@` and emoji completion.
5. With an empty composer, Tab must retain normal focus behavior. With a non-empty ordinary draft, bare Tab must open the ladder.
6. In an active question: empty Tab accepts the recommendation and asks next; Enter previews a brief; Esc dismisses then a second Esc restores the original intent; empty Backspace reopens the prior rung; clicking a rung discards later rungs and reopens it.
7. In done: copy reads `Nothing critical left.`; Enter writes preview and Tab forces another question (`force: true`).
8. In preview: brief is plain scrollable text (not `<pre>`); Copy copies it; Esc returns to ladder; Enter places the brief in the composer.
9. Disable `/brief` or return an error: preview should use the local template; the brief is never auto-sent.
10. While the brief request is pending, press Enter in the composer: middleware must cancel the send.
