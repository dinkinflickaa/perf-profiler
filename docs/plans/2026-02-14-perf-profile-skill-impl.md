# /perf-profile Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the `/perf-profile` Claude Code skill file that orchestrates CPU profiling sessions via the chrome-function-profiler MCP tools.

**Architecture:** Single markdown file at `.claude/skills/perf-profile.md`. Strict orchestration skill — step-by-step guide mapping 1:1 to the 7 implemented MCP tools with exact parameter schemas.

**Tech Stack:** Claude Code skill (markdown with frontmatter)

---

## Task 1: Create the skill file

**Files:**
- Create: `.claude/skills/perf-profile.md`

**Step 1: Create the `.claude/skills/` directory**

Run: `mkdir -p .claude/skills`
Expected: Directory created (or already exists)

**Step 2: Create the skill file**

Create `.claude/skills/perf-profile.md` with the following exact content:

```markdown
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
| `connect` | Connect to Chrome via CDP |
| `disconnect` | Clean up and disconnect |
| `list_targets` | Show pages and workers |
| `profile_scenario` | Single-capture profile |
| `start_profiling_session` | Start multi-capture session |
| `stop_profiling_session` | Stop session, get summary |
| `compare_profiles` | Diff two .cpuprofile files |

## Workflow

Follow these steps in order. Do NOT skip steps. Ask the user at each decision point.

### Step 1: Connection

Check if already connected to Chrome. If not:
- Call `connect` with default port 9222
- If connection fails, tell the user to launch Chrome with `--remote-debugging-port=9222`
- Call `list_targets` to show available targets (main thread, workers)

### Step 2: Scenario Identification

Ask the user:
1. "What scenario do you want to profile?" (e.g., channel switching, data loading, form submission)
2. "What are the `performance.mark` names that bracket this scenario?"
   - They need a start mark and an end mark
   - If the user doesn't know, suggest they check their codebase or add marks

Ask which target to profile:
3. "Should I profile the main thread or a worker?"
   - If worker: "Which worker?" (show the list from Step 1)

### Step 3: Capture Mode

Ask the user:
- "Do you want to capture a **single interaction** or **profile across multiple interactions**?"

**Single capture**: Use `profile_scenario` tool. Tell the user to trigger the scenario once.

**Multi-capture**: Use `start_profiling_session` tool. Tell the user to interact with the app freely and say "done" when finished.

### Step 4: Arm the Profiler

Based on the answers above, call the appropriate tool:

**Single capture:**
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

**Multi-capture:**
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
4. **File locations**: Where the .cpuprofile files are saved

Format the summary as a readable table, not raw JSON.

Note: For single captures via `profile_scenario`, the tool returns duration, label, overlap count, and top functions by hit count. Present these directly — stats/outliers only apply to multi-capture sessions with 3+ captures.

### Step 7: Offer Next Steps

After presenting results, offer these options:

1. **Compare profiles**: "Want me to compare the slowest capture against the fastest to identify which functions are responsible?"
   - If yes: call `compare_profiles` with the two file paths
   - Present the diff as a table: function name, file, line, hits in A, hits in B, delta
   - Focus on the top 5 differences — don't dump 20 rows

2. **Investigate hotspots**: "Want me to look at the source code for the top hotspot functions and suggest optimizations?"
   - If yes: read the source files referenced in the profile's top functions (using URL + line number from the profile data)
   - Identify the inefficiency pattern (uncached lookups, O(n^2) algorithms, redundant allocations, etc.)
   - Suggest specific code changes
   - Ask if the user wants you to apply the fixes

3. **Re-profile**: "Want to run the profiling session again (e.g., after making changes) to measure improvement?"
   - If yes: go back to Step 4

## Guidelines

- Always ask for mark names. Never guess.
- When presenting comparisons, focus on the top 5 differences — don't dump 20 rows.
- When suggesting source code fixes, always read the file first. Never suggest changes to code you haven't seen.
- If the user mentions a function name instead of mark names, ask: "What are the performance.mark names around that function?" Don't try to monkey-patch.
- If connection fails, don't retry repeatedly. Tell the user how to fix it.
- Keep the profiling overhead conversation simple. Don't explain console.profile internals unless asked.
```

**Step 3: Verify the skill file exists and has correct frontmatter**

Run: `head -5 .claude/skills/perf-profile.md`
Expected:
```
---
name: perf-profile
description: Profile a scenario in Chrome...
---
```

**Step 4: Commit**

```bash
git add .claude/skills/perf-profile.md
git commit -m "feat: add /perf-profile skill for CPU profiling orchestration"
```
