---
name: perf-profile
description: Profile a scenario in Chrome using the chrome-function-profiler MCP server. Guides through connecting, identifying performance marks, choosing capture mode, running the session, and presenting results with hotspot analysis.
---

# /perf-profile

You are orchestrating a CPU profiling session using the chrome-function-profiler MCP tools.

**This skill works with performance.mark() names only.** If the user mentions a function name (e.g., "profile transformMessages"), ask: "What are the `performance.mark` names that bracket that function?" This tool does not monkey-patch functions — it listens for marks.

**NEVER read .trace.json or .cpuprofile files with the Read tool or Python.** These files can be tens of megabytes. Always use `jq` via the Bash tool.

## Available Tools

These are the ONLY tools you may call. Do not reference or call any other tool names.

| Tool | Purpose |
|------|---------|
| `connect` | Connect to Chrome via CDP (use `target` param to specify app URL) |
| `disconnect` | Clean up and disconnect |
| `list_targets` | Show pages and workers |
| `profile_scenario` | Single-capture profile (main or worker only) |
| `start_profiling_session` | Start multi-capture session (main, worker, or full) |
| `stop_profiling_session` | Stop session, get summary |
| `compare_profiles` | Diff two .cpuprofile files |

## Quick Reference

For experienced users who already know their marks and setup:

```
1. connect({ target: "localhost:5173" })
2. list_targets()
3. start_profiling_session({ startMark: "X", endMark: "Y", target: "main" })
4. User interacts. Says "done".
5. stop_profiling_session()
6. Present results. Offer comparison.
```

## Prerequisites

- Chrome must be running with `--remote-debugging-port=9222`
- The user's app must already be loaded in Chrome (navigate to it before profiling)
- The user drives all interactions in Chrome — you arm the profiler and present results

## Guidelines

- When presenting comparisons, focus on the top 5 differences — don't dump 20 rows.
- If connection fails, don't retry repeatedly. Tell the user how to fix it.
- Keep the profiling overhead conversation simple. Don't explain console.profile internals unless asked.

## Workflow

Follow these steps in order. Do NOT skip steps. Ask the user at each decision point.

### Step 1: Connection

Ask the user: "What URL is your app running at?" (e.g., `localhost:5173`)

Connect to Chrome, targeting their app's page:
- Call `connect` with `target: "<user's app URL fragment>"` (e.g., `target: "localhost:5173"`)
- A successful connection returns: connection confirmation, list of page targets (with IDs, titles, URLs), and discovered workers (with types and session IDs)
- If connection fails, tell the user to launch Chrome with `--remote-debugging-port=9222`
- If the connect response shows a WARNING about blank/chrome:// pages, ask the user to navigate Chrome to their app first, then reconnect with the `target` parameter
- Call `list_targets` to confirm available targets and note whether workers exist (this determines Step 2c)

### Step 2a: Scenario Identification

Ask the user:
- "What scenario do you want to profile?" (e.g., channel switching, data loading, form submission)

### Step 2b: Mark Names

Ask the user:
- "What are the `performance.mark` names that bracket this scenario?" (they need a start mark and an end mark)
- If the user doesn't know, suggest they check their codebase or add marks
- If the user provides a function name instead of marks, ask: "What are the `performance.mark` names around that function? This tool captures between marks, not function names."

### Step 2c: Target Thread

**If `list_targets` showed no workers:** default to `target: "main"` and skip this question.

**If workers exist**, ask:
- "Do you want to profile a **specific thread** or **all threads (full)?**"
  - If **specific thread**: "Main thread or a worker?" If worker: "Which worker?" (show the list from Step 1)
  - If **all threads (full)**: No thread selection needed. This captures a full trace across all threads.

### Step 3: Capture Mode

Ask the user:
- "Do you want to capture a **single interaction** or **profile across multiple interactions**?"

**Single capture** (specific thread only): Use `profile_scenario` tool. Tell the user to trigger the scenario once.

**Multi-capture**: Use `start_profiling_session` tool. Tell the user to interact with the app freely and say "done" when finished.

**Full mode** is always multi-capture (uses `start_profiling_session` with `target: "full"`).

### Step 4: Arm the Profiler

Based on the answers above, call the appropriate tool:

**Single capture (specific thread):**
```
profile_scenario(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "main",              // or "worker"
  workerUrl: "<if worker>",    // only if target is "worker"
  samplingInterval: 200,       // fine-grained for single captures
  output: "./profiles/profile.cpuprofile",
  timeoutMs: 30000
)
```

**Multi-capture (specific thread):**
```
start_profiling_session(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "main",              // or "worker"
  workerUrl: "<if worker>",    // only if target is "worker"
  samplingInterval: 500,       // lower overhead for longer sessions
  outputDir: "./profiles/<startMark>",
  maxCaptures: 50,
  sessionTimeoutMs: 300000
)
```

**Multi-capture (full — all threads):**
```
start_profiling_session(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "full",              // captures all threads via tracing
  outputDir: "./profiles/<startMark>",
  maxCaptures: 50,
  sessionTimeoutMs: 300000
)
```

Tell the user: "Profiler armed. Go ahead and interact with the app. I'll capture a profile every time the scenario fires. Tell me when you're done."

### Step 5: Wait + Capture

Wait for the user to say they're done.

- **Single capture**: The `profile_scenario` tool blocks until one capture completes or times out (30s default). No user action needed after triggering the scenario.
- **Multi-capture**: Call `stop_profiling_session` when the user says "done."

**If `profile_scenario` times out:**
- The marks may not have fired. Ask the user to verify:
  1. Did they trigger the scenario in the app?
  2. Are the mark names correct? (check for typos, wrong casing)
  3. Is the scenario happening on the expected thread?
- Suggest: "Try running `performance.getEntriesByType('mark')` in the Chrome console to see what marks are actually being created."

**If a session starts but records 0 captures after the user triggers the scenario:**
- The marks might be firing in a different thread than targeted.
- Ask: "Are these marks created in the main thread or in a worker?"
- If worker: restart the session with `target: "worker"` and the worker URL.
- Suggest: "In Chrome console, run `performance.getEntriesByType('mark')` to verify marks are visible in the expected context."

**If the user reports the app reloaded during a session:**
- The session is likely broken. Stop it with `stop_profiling_session` — captures before the reload are still valid.
- Start a new session after the app finishes reloading.

### Step 6: Present Results

Present the results clearly:

1. **Summary table**: Show each capture with label, duration, and whether it had overlapping invocations
2. **Stats**: min, max, avg, p50, p95 durations
3. **Outliers**: Flag any captures > 2 stddev from mean with their labels
4. **File locations**: Where the output files are saved
   - For `.cpuprofile` files: "You can drag any `.cpuprofile` file into Chrome DevTools Performance panel for a full flame chart view."
   - For full mode `.trace.json` files: "You can open `.trace.json` files in `chrome://tracing` or the DevTools Performance panel."

Format the summary as a readable table, not raw JSON.

Note: For single captures via `profile_scenario`, the tool returns duration, label, overlap count, and top functions by hit count. Present these directly — stats/outliers only apply to multi-capture sessions with 3+ captures.

**Interpreting overlapping invocations:** If captures show overlaps > 0, explain to the user: "This capture had overlapping invocations — the scenario was triggered again before the previous one finished. The profile may include work from multiple invocations, which can inflate its duration. Consider profiling with less concurrent activity for cleaner results."

### Step 7: Offer Next Steps

After presenting results, offer these options:

1. **Compare profiles**: "Want me to compare the slowest capture against the fastest to identify which functions are responsible?"
   - If yes: call `compare_profiles` with the two `.cpuprofile` file paths (works for both specific-thread and full mode's extracted profiles)
   - Present the diff as a table: function name, file, line, hits in A, hits in B, delta
   - Focus on the top 5 differences — don't dump 20 rows

2. **Deep analysis**: "Want to dig into the profile data — hotspots, thread activity, GC pressure?"
   - If yes: call the Skill tool with `skill: "perf-analyze"` to load the analysis workflow

3. **Re-profile**: "Want to run the profiling session again (e.g., after making changes) to measure improvement?"
   - If yes: go back to Step 4

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Connection refused | Chrome not launched with `--remote-debugging-port=9222` | Relaunch Chrome with the flag |
| Connected but no targets | App not loaded yet | Ask user to navigate to their app, then `list_targets` |
| Session started but 0 captures | Marks firing in wrong thread, or mark names wrong | Check `performance.getEntriesByType('mark')` in console |
| All captures show 0ms duration | Function completes faster than measurement overhead | Consider broader marks around more work |
| Profile timeout (30s) | Scenario not triggered, or marks not firing | Verify marks exist and scenario was triggered |
| App reloaded mid-session | Navigation destroyed observers | Stop session, start a new one after reload |
| Very large output files | Too many captures or long session | Lower `maxCaptures` or increase `samplingInterval` |

