---
name: perf-analyze
description: Analyze captured .cpuprofile and .trace.json files using jq. Use when the user asks about hotspots, thread activity, GC pressure, timing marks, or wants to compare profile data after a profiling session.
---

# /perf-analyze

You are analyzing CPU profile and trace files captured by the chrome-function-profiler MCP tools.

**CRITICAL: NEVER read .trace.json or .cpuprofile files with the Read tool or Python.** These files can be tens of megabytes. Always use `jq` via the Bash tool.

## jq Sandbox Note

Use `(.x == "y" | not)` instead of `!=` in all jq expressions — the Claude Code sandbox escapes `!=` to `\!=`. All examples below follow this pattern.

## Getting Started

Ask the user which file(s) they want to analyze. If they just finished a `/perf-profile` session, the files are in `./profiles/`.

Determine the file type from the extension:
- `.cpuprofile` — CPU profile (per-thread, function-level hit counts)
- `.trace.json` — full trace (cross-thread, event-level timing)

## Analyzing .cpuprofile Files

### Top functions by hit count

The most common starting point. Shows where CPU time was spent.

```bash
jq '[.nodes[]
  | select(.hitCount > 0
    and (.callFrame.functionName == "(idle)" | not)
    and (.callFrame.functionName == "(root)" | not)
    and (.callFrame.functionName == "(program)" | not))
  ]
  | sort_by(-.hitCount)
  | .[:10]
  | map({fn: .callFrame.functionName, hits: .hitCount, url: .callFrame.url, line: .callFrame.lineNumber})' FILE
```

### Total hit counts (excluding idle)

Useful for understanding how much actual work vs idle time a profile contains.

```bash
jq '{
  total: [.nodes[].hitCount] | add,
  active: [.nodes[]
    | select((.callFrame.functionName == "(idle)" | not)
      and (.callFrame.functionName == "(root)" | not)
      and (.callFrame.functionName == "(program)" | not))
    | .hitCount] | add
  }' FILE
```

### Functions from a specific file/module

Filter to functions from a particular source file when the user wants to focus on their code.

```bash
jq '[.nodes[]
  | select(.hitCount > 0 and (.callFrame.url | test("MODULE_NAME")))
  ]
  | sort_by(-.hitCount)
  | map({fn: .callFrame.functionName, hits: .hitCount, line: .callFrame.lineNumber})' FILE
```

### Quick diff of top functions between two profiles

For ad-hoc comparison without the `compare_profiles` MCP tool. Note: `compare_profiles` now also accepts `.trace.json` files directly with an optional `thread` parameter.

```bash
diff <(jq '[.nodes[]
  | select(.hitCount > 0
    and (.callFrame.functionName == "(idle)" | not)
    and (.callFrame.functionName == "(root)" | not)
    and (.callFrame.functionName == "(program)" | not))
  ]
  | sort_by(-.hitCount) | .[:10]
  | .[].callFrame.functionName' A.cpuprofile) \
     <(jq '[.nodes[]
  | select(.hitCount > 0
    and (.callFrame.functionName == "(idle)" | not)
    and (.callFrame.functionName == "(root)" | not)
    and (.callFrame.functionName == "(program)" | not))
  ]
  | sort_by(-.hitCount) | .[:10]
  | .[].callFrame.functionName' B.cpuprofile)
```

## Analyzing .trace.json Files

### Find thread names

Always start here — you need thread IDs before filtering by thread.

```bash
jq '[.[] | select(.name == "thread_name")] | map({pid, tid, name: .args.name})' FILE
```

### Main thread activity breakdown

Replace `MAIN_TID` with the actual thread ID from the query above.

```bash
jq '[.[] | select(.tid == MAIN_TID and (.name == "thread_name" | not))]
  | group_by(.name)
  | map({name: .[0].name, count: length, total_dur_us: [.[].dur | numbers] | (if length > 0 then add else 0 end)})
  | map(. + {total_dur_ms: (.total_dur_us / 1000)})
  | sort_by(-.total_dur_ms)
  | .[:15]' FILE
```

### Find user timing marks

Shows `performance.mark()` entries — useful for correlating with profiling scenarios.

```bash
jq '[.[] | select(.cat == "blink.user_timing")] | map({name, ts, tid})' FILE
```

### GC activity summary

Quick check for garbage collection pressure.

```bash
jq '[.[] | select(.name | test("GC"))]
  | {count: length, total_ms: ([.[].dur | numbers] | add) / 1000}' FILE
```

### Long tasks (> 50ms)

Find events that would cause jank.

```bash
jq '[.[] | select(.dur > 50000 and (.name == "thread_name" | not))]
  | sort_by(-.dur)
  | .[:10]
  | map({name, dur_ms: (.dur / 1000), tid})' FILE
```

### Activity on a specific thread

Replace `TARGET_TID` with the thread ID you want to inspect.

```bash
jq '[.[] | select(.tid == TARGET_TID and (.name == "thread_name" | not))]
  | group_by(.name)
  | map({name: .[0].name, count: length, total_dur_ms: (([.[].dur | numbers] | add) / 1000)})
  | sort_by(-.total_dur_ms)
  | .[:15]' FILE
```

## Guidelines

- Present results as readable tables, not raw JSON.
- When comparing profiles, focus on the top 5-10 differences — don't dump everything.
- If the user asks about a specific function, filter by its name or source file rather than scanning the full profile.
- If a query returns empty results, suggest checking the file type (`.cpuprofile` vs `.trace.json`) — the schemas are completely different.
- Remind the user they can open `.cpuprofile` files in Chrome DevTools Performance panel and `.trace.json` files in `chrome://tracing` for visual flame charts. Both file types can be compared directly with `compare_profiles` (use the `thread` parameter for `.trace.json` files with multiple threads).
