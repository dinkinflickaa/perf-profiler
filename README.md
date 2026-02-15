# Chrome Function Profiler

An MCP server that captures CPU profiles of specific code scenarios in Chrome. Instead of profiling entire pages, define scenarios with `performance.mark()` pairs and get isolated profiles containing only the work between those marks.

## Table of Contents

- [Why This Exists](#why-this-exists)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Capture Modes](#capture-modes)
- [Demo App](#demo-app)
- [Project Structure](#project-structure)
- [Analyzing Output Files](#analyzing-output-files)
- [Development](#development)

## Why This Exists

Traditional profiling captures everything on the page, making it hard to isolate performance issues in specific interactions. This tool scopes profiling to defined scenarios so you can:

- Profile a single user interaction (e.g., switching a tab, submitting a form)
- Capture multiple repetitions and compare them statistically
- Profile both main thread and web workers independently
- Capture cross-thread traces for full-stack analysis
- Compare a "before" profile against an "after" to measure improvement

## How It Works

The profiler patches `performance.mark()` in the target page to trigger `console.profile()` / `console.profileEnd()` when your start and end marks fire. This starts and stops the V8 CPU profiler **synchronously within the same JS tick** — zero round-trip latency, zero missed work, minimal profile size.

```
Your app calls:           performance.mark('scenario-start')
                                    |
Injected patch calls:     console.profile('capture-1')     // V8 profiler starts immediately
                                    |
         ... your scenario code runs, profiler records ...
                                    |
Your app calls:           performance.mark('scenario-end')
                                    |
Injected patch calls:     console.profileEnd('capture-1')  // V8 profiler stops, profile captured
```

The captured `.cpuprofile` contains only the work executed between the two marks.

## Prerequisites

- **Node.js** >= 18
- **Chrome** launched with remote debugging enabled:
  ```bash
  # macOS
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

  # Linux
  google-chrome --remote-debugging-port=9222
  ```
- Your app must have `performance.mark()` calls bracketing the scenario you want to profile

## Setup

### 1. Clone and build the MCP server

```bash
cd chrome-function-profiler
npm install
npm run build
```

### 2. Register with Claude Code

The `.mcp.json` at the project root registers the server automatically:

```json
{
  "mcpServers": {
    "chrome-profiler": {
      "command": "node",
      "args": ["./chrome-function-profiler/build/index.js"]
    }
  }
}
```

No additional configuration needed — Claude Code picks this up when you open the project.

### 3. (Optional) Set up the demo app

```bash
cd demo-app
npm install
npm run dev
```

This starts a React chat app on `localhost:5173` with intentional performance bottlenecks for practicing the profiling workflow.

## Quick Start

Once Chrome is running with `--remote-debugging-port=9222` and your app is loaded:

1. **Use the `/perf-profile` skill** in Claude Code — it walks through the full workflow interactively
2. Or call the MCP tools directly:

```
connect(target: "localhost:5173")          # Connect to your app's page
list_targets()                              # See available threads

start_profiling_session(                    # Arm the profiler
  startMark: "scenario-start",
  endMark: "scenario-end",
  target: "main",
  outputDir: "./profiles/session"
)

# ... interact with your app — each scenario trigger captures a profile ...

stop_profiling_session()                    # Get summary with stats & outliers
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `connect` | Connect to Chrome via CDP. Use `target` to specify a URL fragment (e.g., `"localhost:5173"`). |
| `disconnect` | Disconnect from Chrome and clean up state. |
| `list_targets` | List available page targets and discovered workers. |
| `profile_scenario` | Capture a single CPU profile between a start mark and end mark. |
| `start_profiling_session` | Start a multi-capture session. Profiles are captured every time the scenario fires. |
| `stop_profiling_session` | Stop the active session and return a summary with stats and outliers. |
| `compare_profiles` | Diff two `.cpuprofile` or `.trace.json` files and show the functions with the largest hit-count differences. |

### Tool Parameters

**`connect`**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `port` | `9222` | CDP debugging port |
| `host` | `"127.0.0.1"` | CDP host address |
| `target` | — | URL fragment to match (e.g., `"localhost:5173"`) |

**`profile_scenario`**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `startMark` | required | `performance.mark` name that starts the scenario |
| `endMark` | required | `performance.mark` name that ends the scenario |
| `target` | `"main"` | `"main"` or `"worker"` |
| `workerUrl` | — | URL fragment to identify the target worker |
| `samplingInterval` | `200` | CPU profiler sampling interval in microseconds |
| `output` | `"./profiles/profile.cpuprofile"` | Output file path |
| `timeoutMs` | `30000` | Timeout in milliseconds |

**`start_profiling_session`**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `startMark` | required | `performance.mark` name that starts the scenario |
| `endMark` | required | `performance.mark` name that ends the scenario |
| `target` | `"main"` | `"main"`, `"worker"`, or `"full"` (cross-thread trace) |
| `workerUrl` | — | URL fragment to identify the target worker |
| `samplingInterval` | `200` | Sampling interval in microseconds (not used in full mode) |
| `outputDir` | `"./profiles/session"` | Directory for output files |
| `maxCaptures` | `50` | Maximum number of captures |
| `sessionTimeoutMs` | `300000` | Session timeout in milliseconds |

**`compare_profiles`**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `profileA` | required | Path to first `.cpuprofile` or `.trace.json` |
| `profileB` | required | Path to second `.cpuprofile` or `.trace.json` |
| `topN` | `20` | Number of top differing functions to show |
| `thread` | — | Thread name to extract from trace (substring match). Use when comparing `.trace.json` files with multiple threads. |

## Capture Modes

### Single Capture (`profile_scenario`)

Captures one profile. Best for isolating a single interaction. Returns the profile duration, top functions by hit count, and the output file path.

### Multi-Capture Session (`start_profiling_session` with `target: "main"` or `"worker"`)

Captures a profile every time the scenario fires. When stopped, returns:
- Summary table of all captures (label, duration, overlap count)
- Duration statistics: min, max, avg, p50, p95, stddev
- Outlier detection (captures > 2 stddev from mean)
- File locations for each capture

### Full Trace Mode (`start_profiling_session` with `target: "full"`)

Captures a cross-thread trace (main + workers) every time the scenario fires. Produces:
- `.trace.json` — full trace containing all thread data, openable in `chrome://tracing` or DevTools Performance panel

Use full mode when you need to understand how work flows across threads. Use `compare_profiles` with the `.trace.json` files and the `thread` parameter to compare specific threads.

## Demo App

The `demo-app/` directory contains a React chat application designed for practicing the profiling workflow. It simulates a messaging app where switching channels triggers data processing across the main thread and a web worker.

**Performance marks available:**
| Mark | Thread | Description |
|------|--------|-------------|
| `channel-switch-start` / `channel-switch-end` | Main | Full channel switch cycle |
| `worker-process-start` / `worker-process-end` | Worker | Data processing in the web worker |
| `render-start` / `render-end` | Main | React render phase |

The app contains 16 intentional performance inefficiencies in `hooks/useChannelData.ts` and `worker/pipeline.ts` — unnecessary JSON deep clones, uncached O(n) lookups, redundant string operations, and more. Use the profiler to find and fix them.

```bash
cd demo-app
npm install
npm run dev    # Starts on localhost:5173
```

## Project Structure

```
perf-analysis/
├── chrome-function-profiler/       # MCP server
│   ├── src/
│   │   ├── index.ts                # Server entry point, tool definitions
│   │   ├── types.ts                # Shared type definitions
│   │   ├── cdp/
│   │   │   ├── connection.ts       # CDP connection manager
│   │   │   ├── session.ts          # Session-scoped CDP commands
│   │   │   └── worker-manager.ts   # Worker discovery & attachment
│   │   ├── profilers/
│   │   │   ├── cpu-profiler.ts     # CPU profiling via console.profile
│   │   │   └── trace-profiler.ts   # Full cross-thread tracing
│   │   ├── instrumentation/
│   │   │   ├── mark-patcher.ts     # performance.mark() patching
│   │   │   └── navigation-handler.ts # Re-inject patches on navigation
│   │   ├── session/
│   │   │   └── profiling-session.ts # Multi-capture session controller
│   │   ├── analysis/
│   │   │   ├── profile-parser.ts   # Parse .cpuprofile format
│   │   │   ├── profile-comparator.ts # Diff two profiles
│   │   │   └── trace-parser.ts     # Parse trace events
│   │   └── utils/
│   │       ├── file-output.ts      # Save profiles to disk
│   │       └── stats.ts            # Statistical analysis (min/max/p50/p95/stddev)
│   ├── package.json
│   └── tsconfig.json
├── demo-app/                       # React chat app with intentional bottlenecks
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/             # ChannelList, MessagePane, StatusBar
│   │   ├── hooks/useChannelData.ts # Main thread processing (with inefficiencies)
│   │   └── worker/                 # Web worker pipeline (with inefficiencies)
│   └── package.json
├── .claude/skills/
│   ├── perf-profile/              # /perf-profile — orchestrate profiling sessions
│   └── perf-analyze/              # /perf-analyze — analyze captured profiles with jq
├── .mcp.json                       # MCP server registration
└── profiles/                       # Default output directory for captured profiles
```

## Analyzing Output Files

### `.cpuprofile` files

Open in Chrome DevTools (Performance tab > Load profile) or use `jq`:

```bash
# Top 10 functions by hit count
jq '[.nodes[] | select(.hitCount > 0 and .callFrame.functionName != "(idle)" and .callFrame.functionName != "(root)" and .callFrame.functionName != "(program)")] | sort_by(-.hitCount) | .[:10] | map({fn: .callFrame.functionName, hits: .hitCount, url: .callFrame.url, line: .callFrame.lineNumber})' profile.cpuprofile
```

### `.trace.json` files

Open in `chrome://tracing` or the DevTools Performance panel, or use `jq`:

```bash
# Find thread names
jq '[.[] | select(.name == "thread_name")] | map({pid, tid, name: .args.name})' trace.json

# Find user timing marks
jq '[.[] | select(.cat == "blink.user_timing")] | map({name, ts, tid})' trace.json

# GC activity summary
jq '[.[] | select(.name | test("GC"))] | {count: length, total_ms: ([.[].dur | numbers] | add) / 1000}' trace.json
```

### `summary.json`

Generated by `stop_profiling_session`. Contains all captures, durations, labels, statistical summary, and outliers in a machine-readable format.

## Development

### Build

```bash
cd chrome-function-profiler
npm install
npm run build       # Compile TypeScript
npm run dev         # Watch mode
```

### Test

```bash
cd chrome-function-profiler
npm test            # Run tests once
npm run test:watch  # Watch mode
```

### Architecture

The server is built on three layers:

1. **CDP Layer** (`cdp/`) — Manages the Chrome DevTools Protocol connection, sessions, and worker discovery
2. **Profiling Layer** (`profilers/`, `instrumentation/`, `session/`) — Handles mark patching, CPU profiling, tracing, and multi-capture sessions
3. **Analysis Layer** (`analysis/`, `utils/`) — Parses profiles, computes diffs, and generates statistical summaries

All tools are registered in `src/index.ts` using the `@modelcontextprotocol/sdk` framework with `zod` schema validation.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `chrome-remote-interface` | Chrome DevTools Protocol client |
| `zod` | Runtime schema validation for tool parameters |
