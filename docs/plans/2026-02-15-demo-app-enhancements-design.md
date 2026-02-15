# Demo App Enhancements Design

## Goal

Enhance the demo chat app with 4 realistic features, each exercising a distinct performance pattern. Every feature includes intentional bottlenecks and performance marks so users can practice profiling with the chrome-function-profiler MCP tools and perf-profile/perf-analyze skills.

## Approach: Diverse Performance Patterns

Each feature targets a different type of performance scenario:

| Feature | Pattern | Thread | Best MCP Mode |
|---|---|---|---|
| Search | CPU-bound regex + re-render per keystroke | Main | Multi-capture session |
| Compose with preview | Cross-thread markdown rendering | Worker | Full trace |
| Reactions | Frequent small DOM updates | Main | Multi-capture session |
| Theme toggle | Cascading re-render + layout thrashing | Main | Single capture |

## Performance Marks

### Existing (unchanged)
- `channel-switch-start` / `channel-switch-end` — main thread, full channel switch
- `render-start` / `render-end` — main thread, React render phase
- `worker-process-start` / `worker-process-end` — worker thread, data pipeline

### New
- `search-start` / `search-end` — main thread, one debounced search keystroke
- `compose-preview-start` / `compose-preview-end` — worker thread, markdown preview render
- `message-send-start` / `message-send-end` — worker thread, send message + pipeline rerun
- `reaction-start` / `reaction-end` — main thread, single reaction toggle
- `theme-switch-start` / `theme-switch-end` — main thread, theme toggle

## Feature 1: Search / Filter Messages

**UI:** Search input in message pane header. Typing filters messages with highlighted matches. Live result count badge.

**Marks:** `search-start` / `search-end` on each debounced keystroke (150ms debounce).

**Intentional inefficiencies:**

- **#17: No memoized search results.** Re-scans all messages from scratch on every keystroke. No incremental filtering even when adding one character.
- **#18: Regex recompilation per message.** Creates a new `RegExp` for every message instead of compiling once before the loop.
- **#19: DOM-based highlight injection (3 passes).** Builds highlight HTML via 3 sequential string replacements: case-insensitive match → `<mark>` wrap, re-parse overlapping bold/italic, re-apply markdown.
- **#20: Unnecessary copy + re-sort on filter.** Spreads filtered results into new array, then re-sorts with slow `localeCompare` sort even though source is already sorted.

**Profiling value:** Multi-capture session — type several characters, each triggers a mark pair. Shows keystroke-by-keystroke CPU cost. Good for statistical analysis and outlier detection.

## Feature 2: Compose with Live Preview

**UI:** Text area at bottom of message pane. Live preview panel renders markdown as user types. "Send" button appends message.

**Marks:**
- `compose-preview-start` / `compose-preview-end` — worker, on each keystroke
- `message-send-start` / `message-send-end` — worker, on send

**Intentional inefficiencies:**

- **#21: Full markdown re-parse every keystroke.** Sends entire compose text to worker on every keystroke (no debounce). Worker runs full `parseMarkdown` + emoji decode + mention resolution + link unfurl simulation.
- **#22: Synthetic link unfurl per URL.** For each URL, worker runs regex extraction, builds preview metadata, does fake lookup against hardcoded URL→metadata map. Multiple intermediate objects per URL.
- **#23: Full pipeline re-run on send.** "Send" re-processes the entire message list through `transformPipeline()` instead of appending the new message to existing results.

**Profiling value:** Full trace mode — see main thread idle while worker processes, then main thread re-renders. Worker-only profiling for send action.

## Feature 3: Reactions & Interactions

**UI:** Hover a message → reaction picker (emoji button row). Click emoji to toggle reaction. Click thread count to expand/collapse replies inline.

**Marks:** `reaction-start` / `reaction-end` on each reaction click.

**Intentional inefficiencies:**

- **#24: Full reaction re-resolve on every click.** Toggling one reaction runs `resolveReactions()` on all messages, re-resolving every reactor name via uncached `resolveAuthor()`.
- **#25: JSON round-trip deep clone.** Handler does `JSON.parse(JSON.stringify(messages))` to clone entire array before modifying one reaction.
- **#26: Thread expand re-renders entire list.** No per-message collapsed state. Toggling a thread sets a global flag and re-renders the entire `MessagePane`.

**Profiling value:** Multi-capture session — click several reactions quickly. Each capture is small/fast, making statistical outlier detection interesting.

## Feature 4: Theme Toggle (Settings)

**UI:** Settings button in sidebar footer. Opens panel with dark/light toggle and message density selector (compact/comfortable/spacious).

**Marks:** `theme-switch-start` / `theme-switch-end` on toggle click.

**Intentional inefficiencies:**

- **#27: Forced layout thrashing.** Instead of swapping a CSS class on `<html>`, iterates `querySelectorAll('.message')` and sets inline styles per element. Read-write-read-write pattern forces layout recalculation per element.
- **#28: Context cascade with no memo.** Theme via React context wrapping entire app. Context change forces re-render of every consumer, including components whose output doesn't depend on theme. No `React.memo` anywhere.

**Profiling value:** Single capture — one toggle gives a complete picture. Ideal for profile comparison (capture channel switch before and after theme toggle, compare profiles).

## File Plan

### New files
- `hooks/useSearch.ts` — search logic + marks
- `hooks/useReactions.ts` — reaction toggle + marks
- `hooks/useTheme.ts` — theme context + layout thrashing
- `components/SearchBar.tsx` — search input UI
- `components/ComposeBox.tsx` — text area + preview panel
- `components/ReactionPicker.tsx` — emoji picker on hover
- `components/SettingsPanel.tsx` — theme + density toggles
- `contexts/ThemeContext.tsx` — theme context provider

### Modified files
- `App.tsx` — wrap with ThemeContext, integrate compose + settings
- `MessagePane.tsx` — search bar, reaction hover, thread expand, highlights
- `worker/data-worker.ts` — handle preview + send message types
- `worker/pipeline.ts` — add preview pipeline function
- `types.ts` — extend with search/theme/compose types
- `styles.css` — all new component styles + theme CSS variables

## Inefficiency Summary

| # | Description | File | Feature |
|---|---|---|---|
| 1-16 | (existing) | worker/pipeline.ts, useChannelData.ts | Channel switch |
| 17 | No memoized search results | hooks/useSearch.ts | Search |
| 18 | Regex recompilation per message | hooks/useSearch.ts | Search |
| 19 | DOM highlight injection (3 passes) | hooks/useSearch.ts | Search |
| 20 | Copy + re-sort on filter | hooks/useSearch.ts | Search |
| 21 | Full markdown re-parse every keystroke | worker/pipeline.ts | Compose |
| 22 | Synthetic link unfurl per URL | worker/pipeline.ts | Compose |
| 23 | Full pipeline re-run on send | hooks/useChannelData.ts | Compose send |
| 24 | Full reaction re-resolve per click | hooks/useReactions.ts | Reactions |
| 25 | JSON round-trip deep clone | hooks/useReactions.ts | Reactions |
| 26 | Thread expand re-renders all | components/MessagePane.tsx | Reactions |
| 27 | Layout thrashing on theme | hooks/useTheme.ts | Theme |
| 28 | Context cascade, no memo | App.tsx + context | Theme |
