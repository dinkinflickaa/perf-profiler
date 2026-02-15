---
name: perf-profile
description: Profile a scenario in Chrome using the chrome-function-profiler MCP server. Guides through connecting, identifying performance marks, choosing capture mode, running the session, and presenting results with hotspot analysis.
---

# /perf-profile

You are orchestrating a CPU profiling session using the chrome-function-profiler MCP tools.

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

## Prerequisites

- Chrome must be running with `--remote-debugging-port=9222`
- The user's app must already be loaded in Chrome (navigate to it before profiling)
- The user drives all interactions in Chrome — you arm the profiler and present results

## Workflow

Follow these steps in order. Do NOT skip steps. Ask the user at each decision point.

### Step 1: Connection

Ask the user: "What URL is your app running at?" (e.g., `localhost:5173`)

Connect to Chrome, targeting their app's page:
- Call `connect` with `target: "<user's app URL fragment>"` (e.g., `target: "localhost:5173"`)
- If connection fails, tell the user to launch Chrome with `--remote-debugging-port=9222`
- If the connect response shows a WARNING about blank/chrome:// pages, ask the user to navigate Chrome to their app first, then reconnect with the `target` parameter
- Call `list_targets` to show available targets (main thread, workers)

### Step 2: Scenario Identification

Ask the user:
1. "What scenario do you want to profile?" (e.g., channel switching, data loading, form submission)
2. "What are the `performance.mark` names that bracket this scenario?"
   - They need a start mark and an end mark
   - If the user doesn't know, suggest they check their codebase or add marks

Ask which target to profile:
3. "Do you want to profile a **specific thread** or **all threads (full)?**"
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
  target: "main" | "worker",
  workerUrl: "<if worker>",
  samplingInterval: 200,
  output: "./profiles/profile.cpuprofile",
  timeoutMs: 30000
)
```

**Multi-capture (specific thread):**
```
start_profiling_session(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "main" | "worker",
  workerUrl: "<if worker>",
  samplingInterval: 200,
  outputDir: "./profiles/session",
  maxCaptures: 50,
  sessionTimeoutMs: 300000
)
```

**Multi-capture (full — all threads):**
```
start_profiling_session(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "full",
  outputDir: "./profiles/session",
  maxCaptures: 50,
  sessionTimeoutMs: 300000
)
```

Tell the user: "Profiler armed. Go ahead and interact with the app. I'll capture a profile every time the scenario fires. Tell me when you're done."

### Step 5: Wait + Capture

Wait for the user to say they're done.

- **Single capture**: The `profile_scenario` tool blocks until one capture completes or times out (30s default). No user action needed after triggering the scenario.
- **Multi-capture**: Call `stop_profiling_session` when the user says "done."

### Step 6: Present Results

Present the results clearly:

1. **Summary table**: Show each capture with label, duration, and whether it had overlapping invocations
2. **Stats**: min, max, avg, p50, p95 durations
3. **Outliers**: Flag any captures > 2 stddev from mean with their labels
4. **File locations**: Where the output files are saved
   - For full mode: mention `.trace.json` files are openable in `chrome://tracing` or the DevTools Performance panel
   - For full mode: mention extracted `.cpuprofile` files are available for comparison

Format the summary as a readable table, not raw JSON.

Note: For single captures via `profile_scenario`, the tool returns duration, label, overlap count, and top functions by hit count. Present these directly — stats/outliers only apply to multi-capture sessions with 3+ captures.

### Step 7: Offer Next Steps

After presenting results, offer these options:

1. **Compare profiles**: "Want me to compare the slowest capture against the fastest to identify which functions are responsible?"
   - If yes: call `compare_profiles` with the two `.cpuprofile` file paths (works for both specific-thread and full mode's extracted profiles)
   - Present the diff as a table: function name, file, line, hits in A, hits in B, delta
   - Focus on the top 5 differences — don't dump 20 rows

2. **Investigate hotspots**: "Want me to look at the source code for the top hotspot functions and suggest optimizations?"
   - If yes: read the source files referenced in the profile's top functions (using URL + line number from the profile data)
   - Identify the inefficiency pattern (uncached lookups, O(n^2) algorithms, redundant allocations, etc.)
   - Suggest specific code changes
   - Ask if the user wants you to apply the fixes

3. **Re-profile**: "Want to run the profiling session again (e.g., after making changes) to measure improvement?"
   - If yes: go back to Step 4

## Analyzing Trace and Profile Files

**CRITICAL: NEVER read .trace.json or .cpuprofile files with the Read tool or load them into Python.** These files can be tens of megabytes. Always use `jq` via the Bash tool.

### Common jq queries for traces

**Find thread names:**
```jq
[.[] | select(.name == "thread_name")] | map({pid, tid, name: .args.name})
```

**Main thread activity breakdown (replace TID):**
```jq
[.[] | select(.tid == MAIN_TID and (.name == "thread_name" | not))]
| group_by(.name)
| map({name: .[0].name, count: length, total_dur_us: [.[].dur | numbers] | (if length > 0 then add else 0 end)})
| map(. + {total_dur_ms: (.total_dur_us / 1000)})
| sort_by(-.total_dur_ms)
| .[:15]
```

Note: Use `(.x == "y" | not)` instead of `!=` — the sandbox escapes `!=` to `\!=`.

**Find user timing marks:**
```jq
[.[] | select(.cat == "blink.user_timing")] | map({name, ts, tid})
```

**GC activity summary:**
```jq
[.[] | select(.name | test("GC"))] | {count: length, total_ms: ([.[].dur | numbers] | add) / 1000}
```

### Common jq queries for .cpuprofile

**Top functions by hit count:**
```jq
[.nodes[] | select(.hitCount > 0 and .callFrame.functionName != "(idle)" and .callFrame.functionName != "(root)" and .callFrame.functionName != "(program)")]
| sort_by(-.hitCount)
| .[:10]
| map({fn: .callFrame.functionName, hits: .hitCount, url: .callFrame.url, line: .callFrame.lineNumber})
```

## Guidelines

- Always ask for mark names. Never guess.
- **NEVER use Read tool or Python on .trace.json or .cpuprofile files. Always use jq.**
- When presenting comparisons, focus on the top 5 differences — don't dump 20 rows.
- When suggesting source code fixes, always read the file first. Never suggest changes to code you haven't seen.
- If the user mentions a function name instead of mark names, ask: "What are the performance.mark names around that function?" Don't try to monkey-patch.
- If connection fails, don't retry repeatedly. Tell the user how to fix it.
- Keep the profiling overhead conversation simple. Don't explain console.profile internals unless asked.
