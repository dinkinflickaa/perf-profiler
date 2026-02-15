# Chrome Function Profiler MCP Server - Implementation Plan

## Overview

An MCP server that connects to a running Chrome instance via CDP (Chrome DevTools Protocol) and provides scenario-scoped CPU profiling. The key innovation: instead of profiling the entire page, you arm a profiler for a specific scenario (identified by `performance.mark` pairs), trigger interactions, and capture clean, isolated profiles containing only what executed during that scenario's lifetime.

The profiler uses `console.profile()`/`console.profileEnd()` injected via a `performance.mark` patch. This starts and stops the V8 CPU profiler **synchronously within the JS context** — zero round-trip latency, zero missed work, minimal profile size.

This is designed to work alongside the existing DevTools MCP server (not a fork). Both servers connect to Chrome's debug port independently via separate CDP sessions.

**Scope**: CPU profiling only. Memory profiling (HeapProfiler) is deferred to a future phase.

---

## Project Structure

```
chrome-function-profiler/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # MCP server entry point + tool registration
│   ├── cdp/
│   │   ├── connection.ts           # CDP connection manager (DI, not singleton)
│   │   ├── session.ts              # Session-scoped CDP command wrapper
│   │   └── worker-manager.ts       # Worker target discovery and attachment
│   ├── profilers/
│   │   ├── cpu-profiler.ts         # CPU profiling via console.profile + Profiler domain
│   │   └── network-capture.ts      # Network capture during profiling window
│   ├── instrumentation/
│   │   ├── mark-patcher.ts         # performance.mark patching for console.profile signals
│   │   ├── measure-observer.ts     # PerformanceObserver fallback for measure-only mode
│   │   └── navigation-handler.ts   # Re-inject instrumentation on page navigation
│   ├── session/
│   │   ├── profiling-session.ts    # Multi-capture session: arm, accumulate, summarize
│   │   └── capture-accumulator.ts  # Collect profiles across multiple invocations
│   ├── analysis/
│   │   ├── profile-parser.ts       # Parse .cpuprofile format
│   │   ├── profile-comparator.ts   # Diff two profiles, find hotspots
│   │   └── summary-generator.ts    # Generate human-readable summaries
│   └── utils/
│       ├── file-output.ts          # Save profiles in DevTools-loadable formats
│       └── stats.ts                # Percentile, min, max, avg calculations
├── .mcp.json                       # Example MCP config for Claude Code
└── README.md
```

---

## CDP Domains Used

### Confirmed APIs (stable, well-documented)

| Domain | Methods / Events | Purpose |
|--------|-----------------|---------|
| `Profiler` | `enable`, `setSamplingInterval` | Configure CPU profiler before `console.profile()` calls |
| `Profiler` | events: `consoleProfileStarted`, `consoleProfileFinished` | Receive profile data triggered by `console.profile()`/`console.profileEnd()` in page JS |
| `Runtime` | `evaluate` | Inject `performance.mark` patch and auto-labeling queries |
| `Runtime` | `addBinding` | Signal bridge for measure-mode fallback only |
| `Runtime` | event: `executionContextCreated` | Detect navigations to re-inject instrumentation |
| `Network` | `enable`, events: `requestWillBeSent`, `responseReceived`, `loadingFinished` | Capture network during profiling window |
| `Target` | `setAutoAttach`, `getTargets`, events: `attachedToTarget`, `detachedFromTarget` | Worker discovery and session creation |

### Key CDP Behavioral Notes

1. **Profiler domain is session-scoped**: Each CDP session (main thread vs worker) has its own independent Profiler state. Starting profiling on a worker session does NOT capture main thread activity. This is the foundation of our thread-scoped profiling.

2. **`console.profile()` / `console.profileEnd()` trigger CDP events**: When called in page/worker JS, `console.profile(title)` fires `Profiler.consoleProfileStarted` and `console.profileEnd(title)` fires `Profiler.consoleProfileFinished` with the full `Profile` object. These execute **synchronously in the V8 isolate** — the profiler starts/stops in the same tick as the call, with no IPC round-trip. This is how we achieve zero-latency profiler start/stop.

3. **`Profiler.setSamplingInterval` affects `console.profile()`**: The sampling interval is set on the V8 `CpuProfiler` instance via CDP. Since `console.profile()` uses the same `CpuProfiler`, calling `Profiler.enable()` + `Profiler.setSamplingInterval()` before any `console.profile()` call configures the sampling rate. **Must be verified during implementation.**

4. **`Profiler.consoleProfileFinished` return value**: Contains a `profile` field of type `Profile` with:
   - `nodes`: Array of `ProfileNode` (id, callFrame with functionName/url/lineNumber/columnNumber, hitCount, children)
   - `startTime` / `endTime`: Microsecond timestamps (V8 internal monotonic clock)
   - `samples`: Array of node IDs (which node was on top of stack at each sample)
   - `timeDeltas`: Microsecond intervals between samples
   This is the `.cpuprofile` format. Save as JSON and it loads directly in Chrome DevTools Performance panel.

5. **Target.setAutoAttach with flatten: true**: Gives each worker its own `sessionId`. All CDP commands sent with that `sessionId` are routed to that worker's V8 isolate. Without `flatten: true`, you get nested protocol messages which are harder to work with.

6. **Profiler.setSamplingInterval**: Must be called BEFORE any profiling starts. Default is 1000 microseconds. Lower values give more precise profiles but higher overhead. For scenario-scoped profiling where we want accuracy, use 100-500 microseconds.

7. **`Runtime.addBinding` constraint**: The bound function takes exactly one argument which **must be a string**. Passing any other type throws an exception in the page context. Only used for measure-mode fallback, not the primary marks-mode flow.

8. **`Runtime.addBinding` delivers events asynchronously**: While the binding function executes synchronously in JS, the `Runtime.bindingCalled` event is delivered asynchronously over the WebSocket CDP transport. This is why we avoid it for profiler start/stop signals and use `console.profile()` instead.

---

## MCP Tools Definition

### Tool 1: `connect`

**Purpose**: Establish CDP connection to a Chrome instance.

```typescript
{
  name: "connect",
  description: "Connect to a Chrome instance's debug port",
  inputSchema: {
    type: "object",
    properties: {
      port: { type: "number", default: 9222, description: "Chrome remote debugging port" },
      host: { type: "string", default: "127.0.0.1" }
    }
  }
}
```

**Implementation**:
- Use `chrome-remote-interface` npm package to connect: `const client = await CDP({ port, host })`
- Store the client in a connection registry (not module-level singleton) to support testability and potential multi-instance use
- Enable `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true })` immediately
- Listen for `Target.attachedToTarget` events to track worker sessions
- Listen for `Target.detachedFromTarget` to clean up worker sessions
- Return list of available targets (page URL, workers found)

### Tool 2: `disconnect`

**Purpose**: Clean up CDP connection and any active profiling sessions.

```typescript
{
  name: "disconnect",
  description: "Disconnect from Chrome and clean up all active profiling sessions",
  inputSchema: { type: "object", properties: {} }
}
```

**Implementation**:
- Stop any active profiling sessions (restore `performance.mark`, remove observers)
- Close the CDP connection
- Clear the connection registry entry

### Tool 3: `list_targets`

**Purpose**: Show available profiling targets (main thread, workers, service workers).

```typescript
{
  name: "list_targets",
  description: "List all available profiling targets (main thread, workers)",
  inputSchema: { type: "object", properties: {} }
}
```

**Implementation**:
- Query stored worker sessions from the auto-attach listener
- For each target, return: `{ id, type, url, sessionId }`
- Also include the main page target
- If multiple workers match a URL fragment, list all with indices for disambiguation
- This helps Claude (or the user) identify which target to profile

### Tool 4: `profile_scenario`

**Purpose**: Arm a CPU profiler scoped to a specific scenario (defined by performance.mark pairs), wait for the user to trigger it, capture a single profile. For multi-capture across many interactions, use `start_profiling_session`.

**NOTE**: Claude should ask the user for the `performance.mark` names that bracket the scenario.

```typescript
{
  name: "profile_scenario",
  description: "Profile CPU execution of a specific scenario defined by performance.mark pairs. Arms the profiler and waits for the start mark to fire (triggered by user interaction). Captures a single .cpuprofile scoped to exactly the work between the marks.",
  inputSchema: {
    type: "object",
    properties: {
      startMark: {
        type: "string",
        description: "Name of the performance.mark() at scenario entry (e.g., 'transform-start')"
      },
      endMark: {
        type: "string",
        description: "Name of the performance.mark() at scenario exit (e.g., 'transform-end')"
      },
      target: {
        type: "string",
        enum: ["main", "worker"],
        default: "main",
        description: "Which thread to profile"
      },
      workerUrl: {
        type: "string",
        description: "Partial URL match to identify the specific worker (when target is 'worker'). If multiple workers match, use list_targets to disambiguate."
      },
      samplingInterval: {
        type: "number",
        default: 200,
        description: "CPU sampling interval in microseconds. Lower = more precise but more overhead."
      },
      captureNetwork: {
        type: "boolean",
        default: false,
        description: "Also capture network requests during the profiling window"
      },
      output: {
        type: "string",
        default: "./profiles/profile.cpuprofile",
        description: "Output file path"
      },
      timeoutMs: {
        type: "number",
        default: 30000,
        description: "Maximum time to wait for the scenario to execute"
      }
    },
    required: ["startMark", "endMark"]
  }
}
```

**Implementation**: Delegates to the session infrastructure with `maxCaptures: 1` + auto-stop. See `start_profiling_session` for the core flow.

### Tool 5: `start_profiling_session`

**Purpose**: Start a passive profiling session that captures every scenario invocation while the user interacts with the app manually. No interaction automation. The user clicks through channels, sends messages, whatever they want. Each time the scenario fires (start mark → end mark), a profile is silently captured. When done, they tell Claude to stop and get a comparative summary.

**IMPORTANT: Claude should ask the user for the performance.mark names that bracket the scenario.**

```
Claude's decision flow:
  1. Ask user: "What are the performance.mark names that bracket the scenario?"
  2. User provides startMark + endMark -> use performance-marks mode (primary)
  3. If user only has a performance.measure name -> use performance-measure mode (fallback)
```

```typescript
{
  name: "start_profiling_session",
  description: "Start a multi-capture profiling session. Arms a profiler on a scenario (defined by performance.mark pairs) and captures a separate profile every time it fires. The user interacts with the app normally and the tool silently captures a profile for each invocation. Call stop_profiling_session when done.",
  inputSchema: {
    type: "object",
    properties: {
      startMark: {
        type: "string",
        description: "Name of the performance.mark() at scenario entry"
      },
      endMark: {
        type: "string",
        description: "Name of the performance.mark() at scenario exit"
      },
      target: {
        type: "string",
        enum: ["main", "worker"],
        default: "main"
      },
      workerUrl: { type: "string" },
      captureNetwork: {
        type: "boolean",
        default: true,
        description: "Also capture network requests during each invocation"
      },
      instrumentationMode: {
        type: "string",
        enum: ["auto", "performance-marks", "performance-measure"],
        default: "auto",
        description: "How to detect scenario start/stop. 'performance-marks' (recommended) patches performance.mark to call console.profile synchronously. 'performance-measure' is a fallback that uses pre-armed profiling with trimming."
      },
      measureName: {
        type: "string",
        description: "For performance-measure mode only: name of the existing measure wrapping the scenario"
      },
      samplingInterval: {
        type: "number",
        default: 200,
        description: "CPU sampling interval in microseconds"
      },
      outputDir: {
        type: "string",
        default: "./profiles/session"
      },
      maxCaptures: {
        type: "number",
        default: 50,
        description: "Safety limit on number of captures per session"
      },
      sessionTimeoutMs: {
        type: "number",
        default: 300000,
        description: "Auto-stop session after this duration (default 5 minutes). Prevents leaked sessions if the user forgets to say 'done'."
      }
    },
    required: ["startMark", "endMark"]
  }
}
```

**Auto mode resolution**:
- If `startMark` + `endMark` are provided → performance-marks mode
- If `measureName` is provided → performance-measure mode

**Implementation flow (performance-marks mode — primary)**:

```
1. Resolve target session (main thread or worker by URL match)
2. On that session:
   a. Profiler.enable()
   b. Profiler.setSamplingInterval({ interval: samplingInterval })
   c. Listen for Runtime.executionContextCreated (for navigation re-injection)
   d. Inject performance.mark patch via Runtime.evaluate (see Core Mechanism below)
   e. If captureNetwork: Network.enable() on main session
3. Listen for Profiler.consoleProfileStarted events:
   - Open network capture window
   - Log: "Scenario started (capture #{captureIndex})"
4. Listen for Profiler.consoleProfileFinished events:
   - Save event.profile as invocation-{captureIndex}.cpuprofile
   - Close network capture window, save .network.json
   - Auto-label the capture via Runtime.evaluate (see below)
   - Push to captures array
   - Log: "Captured #{captureIndex} '{label}' - {duration}ms"
   - Check overlap annotation in event.title (see re-entrancy handling)
5. Initialize session state:
   - captures: []
   - captureIndex: 0
   - sessionTimer: setTimeout for sessionTimeoutMs
6. Return immediately:
   "Session started. Profiling every scenario between '{startMark}' and '{endMark}'.
    Interact with the app normally. Tell me when you're done."
```

**Auto-labeling**: Each capture gets a meaningful label without user input. On each `consoleProfileFinished` event, the tool runs a quick `Runtime.evaluate`:

```javascript
(function() {
  const active = document.querySelector('[aria-selected="true"]')
    || document.querySelector('[aria-current="true"]')
    || document.querySelector('.active[role="treeitem"]')
    || document.querySelector('.selected');
  if (active) return active.textContent?.trim().slice(0, 50);
  return location.hash || location.pathname.split('/').pop() || 'invocation';
})();
```

When you click "General" channel, the capture labels itself "General". Click "Standup", labels "Standup". No manual labeling needed. Falls back to "invocation-N" if no active element is detected.

**Auto-labeling is pluggable**: Users can provide a custom labeling function via a `labelFunction` parameter (a JS expression string that returns a string). This allows adapting to different app structures beyond chat UIs.

### Tool 5b: `stop_profiling_session`

```typescript
{
  name: "stop_profiling_session",
  description: "Stop the active profiling session, restore performance.mark, and generate a comparative summary of all captured invocations.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID from start_profiling_session. Omit to stop the most recent."
      }
    }
  }
}
```

**Implementation flow**:

```
1. Clean up instrumentation:
   - Restore original performance.mark via Runtime.evaluate
   - Remove PerformanceObserver if measure mode was used
   - Clear session timeout timer
2. Remove CDP event listeners
3. Compute aggregate stats across all captures:
   CPU: min, max, avg, p50, p95, stddev for duration
   Network: request counts, cache hit patterns, payload sizes
4. Identify outliers (captures > 2 stddev from mean)
5. Detect patterns:
   - First visit vs revisit (is the first call to each label slower?)
   - Cumulative degradation (are later captures slower than earlier ones?)
   - Correlation: duration vs network payload size
6. Save summary.json with all captures + stats + patterns
7. Return structured summary to Claude
```

**Summary output**:

```json
{
  "sessionId": "sess_1707912345",
  "startMark": "transform-start",
  "endMark": "transform-end",
  "instrumentationMode": "performance-marks",
  "totalCaptures": 10,
  "captures": [
    { "index": 1, "label": "General", "duration": 45.2,
      "networkBytes": 145000, "overlappingInvocations": 1,
      "files": { "cpu": "invocation-1.cpuprofile" } },
    { "index": 2, "label": "Standup", "duration": 12.1,
      "networkBytes": 0, "overlappingInvocations": 1,
      "files": { "cpu": "invocation-2.cpuprofile" } }
  ],
  "stats": {
    "cpu": { "min": 8.2, "max": 120.8, "avg": 54.3, "p50": 45.2, "p95": 120.8, "stddev": 38.1 }
  },
  "outliers": [
    { "label": "Design Review", "metric": "cpu.duration", "value": 120.8, "zscore": 2.3 }
  ],
  "patterns": {
    "firstVisitVsRevisit": "First visits avg 65ms, revisits avg 10ms (6.5x slower)",
    "networkCorrelation": "r=0.92 between response payload size and CPU duration"
  }
}
```

### Tool 6: `compare_profiles`

**Purpose**: Diff two CPU profiles to find what changed.

```typescript
{
  name: "compare_profiles",
  description: "Compare two CPU profiles to identify performance differences. Shows which functions got hotter/colder between the two profiles.",
  inputSchema: {
    type: "object",
    properties: {
      profileA: { type: "string", description: "Path to the 'fast' or 'baseline' profile" },
      profileB: { type: "string", description: "Path to the 'slow' or 'regression' profile" },
      topN: { type: "number", default: 20, description: "Number of top differences to return" }
    },
    required: ["profileA", "profileB"]
  }
}
```

**Implementation**:

```
1. Parse both .cpuprofile files
2. For each profile, aggregate self-time (hitCount) by function:
   - Key: `${functionName}:${url}:${lineNumber}`
   - Value: total hitCount across all nodes with that callFrame
3. Compute deltas: for each function, (profileB hits - profileA hits)
4. Sort by absolute delta descending
5. Return top N with:
   - Function name, URL, line number
   - Hits in A, hits in B, delta
   - Percentage of total time in each profile
```

### Tool 7: `analyze_profiles`

**Purpose**: Generate a comprehensive analysis of a profile directory from a multi-interaction session.

```typescript
{
  name: "analyze_profiles",
  description: "Analyze a directory of profiles from a multi-interaction session. Identifies patterns, correlations between CPU time and network payload size, and actionable optimization suggestions.",
  inputSchema: {
    type: "object",
    properties: {
      profileDir: { type: "string", description: "Directory containing profiles from a profiling session" },
      focusArea: {
        type: "string",
        enum: ["cpu", "network", "all"],
        default: "all"
      }
    },
    required: ["profileDir"]
  }
}
```

**Implementation**:

```
1. Load summary.json from the directory
2. Load all individual .cpuprofile files
3. Perform analysis:
   CPU:
   - Correlation: duration vs network payload size (Pearson r)
   - Identify functions that appear in slow profiles but not fast ones
   - Detect if time is spent in framework code vs app code (by URL classification)
   Network:
   - Cache hit rate analysis (same URL fetched multiple times?)
   - Payload size distribution
   - Slow request identification
4. Return structured analysis with actionable suggestions
```

---

## Core Mechanism: `console.profile()` via `performance.mark` Patching

The most critical piece of the architecture is how we start and stop the V8 CPU profiler with zero latency. The solution: patch `performance.mark()` to call `console.profile()`/`console.profileEnd()` synchronously in the same tick as the mark.

### Why this approach

1. **Zero latency**: `console.profile()` starts the V8 sampling profiler synchronously within the JS context. No IPC round-trip to CDP. The profiler is already sampling by the time the first line of scenario work executes.
2. **Clean profiles**: The profiler is OFF between scenarios. Each profile contains only the work between start and end marks. No noise, minimal file size.
3. **Zero overhead between iterations**: The profiler is not running between interactions. No distortion of measurements.
4. **Reliable**: Works in both main thread and workers (Console API is available in workers).
5. **No polling, no timers**: The profile data arrives via `Profiler.consoleProfileFinished` CDP event after `console.profileEnd()` fires.

### Why NOT `Runtime.addBinding` + `Profiler.start()`/`stop()`

The alternative approach (used by the original plan) has `performance.mark` → PerformanceObserver → `Runtime.addBinding` → CDP event → `Profiler.start()`. This path has two fatal problems:

1. **PerformanceObserver callbacks are queued as tasks**, not synchronous. If the marks and work are in the same synchronous block, the observer fires AFTER the work is already done.
2. **`Runtime.addBinding` delivers events asynchronously** over WebSocket. Even if the observer fires in time, there's a 1-5ms round-trip before `Profiler.start()` executes. The first 1-5ms of work is missed.

`console.profile()` avoids both problems by running synchronously in the same call stack as `performance.mark()`.

### Why NOT `PerformanceObserver` + `Runtime.addBinding`

See above — PerformanceObserver callbacks fire as queued tasks, not synchronously. By the time the observer runs and signals back via the binding, the work between the marks may already be complete.

### Injected `performance.mark` patch (via `Runtime.evaluate`)

```javascript
(function() {
  const startMark = '{{START_MARK}}';
  const endMark = '{{END_MARK}}';
  const maxCaptures = {{MAX_CAPTURES}};
  const origMark = performance.mark.bind(performance);

  let captureIndex = 0;
  let depth = 0;
  let maxDepthThisCapture = 0;

  // Store original for restoration
  performance.__originalMark = origMark;

  performance.mark = function(name, options) {
    if (name === startMark && captureIndex < maxCaptures) {
      depth++;
      if (depth > maxDepthThisCapture) maxDepthThisCapture = depth;
      if (depth === 1) {
        captureIndex++;
        // Encode capture index in title for server-side tracking
        console.profile('capture-' + captureIndex);
      }
    }

    const result = origMark(name, options);

    if (name === endMark && depth > 0) {
      depth--;
      if (depth === 0) {
        // Encode overlap info in title: "capture-3" or "capture-3:overlap-2"
        const title = 'capture-' + captureIndex +
          (maxDepthThisCapture > 1 ? ':overlap-' + maxDepthThisCapture : '');
        maxDepthThisCapture = 0;
        console.profileEnd(title);
      }
    }

    return result;
  };
})();
```

**Key design decisions in the injected code**:

1. **Re-entrancy handling via depth counter**: If the start mark fires while already profiling (re-entrant/nested call), increment depth but don't start a second `console.profile()`. Only the outermost start/stop pair triggers profiling. This produces one merged profile for overlapping invocations.

2. **Overlap annotation**: When `maxDepthThisCapture > 1`, the overlap count is encoded in the `console.profileEnd()` title. The server parses this from the `Profiler.consoleProfileFinished` event's `title` field and annotates the capture with `overlappingInvocations: N`. Claude can then report: "Note: this capture had 2 overlapping invocations; profile reflects merged work."

3. **`console.profileEnd()` title matching**: `console.profileEnd(title)` ends the most recently started profile. Since we only ever have one active `console.profile()` at a time (the depth counter ensures this), the title used in `profileEnd` does not need to exactly match the `profile` call — it ends the current profile. We use a potentially different title (with overlap suffix) and this works because there's only one active profile.

4. **Safety limit via `maxCaptures`**: Prevents runaway profiling if the mark fires in a hot loop.

### Restoration template

```javascript
(function() {
  if (performance.__originalMark) {
    performance.mark = performance.__originalMark;
    delete performance.__originalMark;
  }
})();
```

### Server-side event handling

```typescript
// One-time setup on the target session
await sendToSession(client, 'Profiler.enable', {}, sessionId);
await sendToSession(client, 'Profiler.setSamplingInterval', {
  interval: samplingInterval
}, sessionId);

// Inject the performance.mark patch
await sendToSession(client, 'Runtime.evaluate', {
  expression: markPatchCode,
  // For workers, this evaluates in the worker context
}, sessionId);

// Listen for completed profiles
client.on('Profiler.consoleProfileFinished', (event) => {
  // event.profile: the full Profile object (same as Profiler.stop() returns)
  // event.title: 'capture-N' or 'capture-N:overlap-M'
  const { captureIndex, overlapCount } = parseCaptureTitle(event.title);

  // Save the profile
  const filename = `invocation-${captureIndex}.cpuprofile`;
  saveProfile(event.profile, path.join(outputDir, filename));

  // Auto-label via Runtime.evaluate
  const label = await getAutoLabel(client, sessionId);

  captures.push({
    index: captureIndex,
    label,
    duration: (event.profile.endTime - event.profile.startTime) / 1000, // us to ms
    overlappingInvocations: overlapCount,
    files: { cpu: filename }
  });
});

// Listen for profile starts (for network capture windowing)
client.on('Profiler.consoleProfileStarted', (event) => {
  if (captureNetwork) openNetworkWindow();
});
```

### Navigation handling

When the page navigates, the injected `performance.mark` patch is lost (the execution context is destroyed and recreated). The binding from `Runtime.addBinding` survives navigations, but our patch does not.

**Solution**: Listen for `Runtime.executionContextCreated` events and re-inject the patch:

```typescript
client.on('Runtime.executionContextCreated', async (event) => {
  if (activeSession && event.context.auxData?.isDefault) {
    // Re-inject the performance.mark patch into the new context
    await sendToSession(client, 'Runtime.evaluate', {
      expression: markPatchCode,
    }, sessionId);
  }
});
```

**Note**: Any in-flight capture at the time of navigation is lost (the `console.profile()` was started in the old context). The server should detect this (a `consoleProfileStarted` without a matching `consoleProfileFinished`) and log a warning: "Capture #{N} was interrupted by a page navigation."

---

## Fallback: Pre-Armed Profiler for Measure Mode

When the user only knows a `performance.measure` name (no individual mark names available), we fall back to a pre-armed approach. This is less precise and has caveats, but handles the case.

### When to use

- The codebase uses `performance.measure('name', { start: startTime })` without explicit mark names
- The user only knows the measure name, not the underlying marks

### Flow

```
1. Profiler.enable() + Profiler.setSamplingInterval()
2. Runtime.addBinding({ name: '__measureSignal' })
3. Inject PerformanceObserver for the measure name (see below)
4. Wait for user to interact
5. User is about to interact → call Profiler.start() (pre-arm)
   NOTE: The tool cannot know exactly when to pre-arm. Options:
     a. Pre-arm immediately and keep profiler running until measure fires
     b. Expose an explicit "arm" action for the user to trigger before each interaction
   Option (a) is simpler but captures noise; option (b) is cleaner but requires user coordination.
6. PerformanceObserver detects measure → signals MCP server via Runtime.addBinding
7. Profiler.stop() → get profile
8. Trim profile to the measure's time window (see time base calibration below)
9. Save trimmed profile
```

### PerformanceObserver for measure mode

```javascript
(function() {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === '{{MEASURE_NAME}}') {
        // Runtime.addBinding argument MUST be a string
        __measureSignal(JSON.stringify({
          name: entry.name,
          duration: entry.duration,
          startTime: entry.startTime
        }));
        performance.clearMeasures(entry.name);
      }
    }
  }).observe({ entryTypes: ['measure'] });
})();
```

### Time base calibration (corrected)

**Problem**: `PerformanceObserver` `entry.startTime` uses `performance.now()` time base (milliseconds from document time origin). `Profile.startTime` from CDP uses V8's internal monotonic clock (microseconds from a different epoch). These cannot be compared directly.

**Solution**: Calibrate through a shared reference point. When we pre-arm the profiler, capture `performance.now()` at roughly the same moment:

```typescript
// Step 1: Capture performance.now() in the page
const { result } = await Runtime.evaluate({
  expression: 'performance.now()',
  returnByValue: true
}, sessionId);
const perfNowAtArm = result.value; // ms, performance.now() time base

// Step 2: Start the profiler (the profile.startTime will be in V8 time base)
await Profiler.start(sessionId);

// ... later, when measure fires with entry.startTime and entry.duration ...

// Step 3: Trim using relative offsets from the calibration point
function trimProfileToWindow(
  profile: Profile,
  measureStartTime: number,   // entry.startTime (ms, performance.now() base)
  measureDuration: number,    // entry.duration (ms)
  perfNowAtArm: number        // performance.now() when profiler was armed (ms)
): Profile {
  // Compute relative offsets from the shared calibration point (in microseconds)
  const relativeStartUs = (measureStartTime - perfNowAtArm) * 1000;
  const relativeEndUs = (measureStartTime + measureDuration - perfNowAtArm) * 1000;

  // Walk profile samples using timeDeltas (relative to profile.startTime)
  let elapsed = 0;
  const keepIndices: number[] = [];

  for (let i = 0; i < profile.timeDeltas.length; i++) {
    elapsed += profile.timeDeltas[i];
    if (elapsed >= relativeStartUs && elapsed <= relativeEndUs) {
      keepIndices.push(i);
    }
  }

  return {
    nodes: profile.nodes, // keep all nodes (referenced by samples)
    startTime: profile.startTime + relativeStartUs,
    endTime: profile.startTime + relativeEndUs,
    samples: keepIndices.map(i => profile.samples[i]),
    timeDeltas: keepIndices.map(i => profile.timeDeltas[i]),
  };
}
```

**Why this works**: We never compare absolute timestamps across time bases. Both `performance.now()` and V8's internal clock are monotonic, so relative deltas from a shared moment are compatible. The ~1-2ms jitter between the `Runtime.evaluate('performance.now()')` call and `Profiler.start()` is acceptable for scenarios taking 10ms+.

### Trade-offs of measure mode

| Aspect | Marks mode (primary) | Measure mode (fallback) |
|--------|---------------------|------------------------|
| Latency | Zero (synchronous console.profile) | 1-2ms calibration jitter |
| Profile noise | None (profiler OFF between scenarios) | Contains pre-arm noise (trimmed, but file is larger) |
| Profiling overhead | Only during scenario | During pre-arm + scenario |
| Complexity | Simple (inject patch, listen for events) | Complex (calibration, trimming, binding) |
| Reliability | High | Moderate (time base calibration, PerformanceObserver task timing) |

**Recommendation**: Always prefer marks mode. If the codebase uses `performance.measure` but also has the underlying marks, ask for the mark names and use marks mode.

---

## Worker Session Management

### Discovery

```typescript
// On connection, immediately enable auto-attach
await client.send('Target.setAutoAttach', {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true
});

// Track worker sessions
const workerSessions = new Map<string, { sessionId: string; url: string; type: string }>();

client.on('Target.attachedToTarget', (event) => {
  const { sessionId, targetInfo } = event;
  if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker') {
    workerSessions.set(sessionId, {
      sessionId,
      url: targetInfo.url,
      type: targetInfo.type
    });
  }
});

client.on('Target.detachedFromTarget', (event) => {
  workerSessions.delete(event.sessionId);
});
```

### Sending commands to a worker session

```typescript
async function sendToSession(
  client: CDPClient,
  method: string,
  params: any,
  sessionId?: string
): Promise<any> {
  if (sessionId) {
    return client.send(method, params, sessionId);
  }
  return client.send(method, params);
}
```

### Finding a worker by URL

```typescript
function findWorkerSessions(urlFragment: string): WorkerSession[] {
  const matches: WorkerSession[] = [];
  for (const [_, worker] of workerSessions) {
    if (worker.url.includes(urlFragment)) matches.push(worker);
  }
  return matches;
}
```

If multiple workers match the same URL fragment, `list_targets` shows all matches with indices. The user can then specify a more precise `workerUrl` or use the worker index.

### Note on `waitForDebuggerOnStart`

Setting `waitForDebuggerOnStart: false` means dynamically created workers start executing before we can attach. This is fine for our use case — we're profiling user-triggered scenarios, so the worker must already exist before the user triggers the scenario. Workers created during the scenario execution will be discovered but not profiled until the next invocation.

---

## Output Formats

### .cpuprofile (from `Profiler.consoleProfileFinished`)

Direct JSON serialization of the CDP `Profile` object. Loadable in:
- Chrome DevTools Performance panel (drag and drop or import)
- VS Code's built-in profiler
- speedscope.app (web-based flame chart viewer)

### summary.json (from multi-interaction sessions)

```json
{
  "startMark": "transform-start",
  "endMark": "transform-end",
  "target": "worker",
  "timestamp": "2026-02-14T10:30:00Z",
  "captures": [
    {
      "index": 1,
      "label": "general-channel",
      "duration": 45.2,
      "overlappingInvocations": 1,
      "topFunctions": [
        { "name": "flatMap", "selfTime": 12.3, "url": "chunk-abc.js", "line": 1234 },
        { "name": "createElement", "selfTime": 8.1, "url": "react-dom.js", "line": 456 }
      ],
      "network": {
        "requestCount": 2,
        "totalBytes": 145000,
        "requests": [
          { "url": "/graphql?op=GetMessages", "latency": 120, "bytes": 130000 }
        ]
      },
      "files": {
        "cpu": "invocation-1.cpuprofile",
        "network": "invocation-1.network.json"
      }
    }
  ],
  "stats": {
    "cpu": { "min": 8.2, "max": 120.8, "avg": 54.3, "p50": 45.2, "p95": 120.8, "stddev": 38.1 }
  },
  "outliers": [
    { "label": "design-review", "metric": "cpu.duration", "value": 120.8, "zscore": 2.3 }
  ],
  "patterns": {
    "firstVisitVsRevisit": "First visits avg 65ms, revisits avg 10ms (6.5x slower)",
    "networkCorrelation": "r=0.92 between response payload size and CPU duration"
  }
}
```

---

## Dependencies

```json
{
  "name": "chrome-function-profiler-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "chrome-function-profiler": "./build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^2.0.0",
    "chrome-remote-interface": "^0.33.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## Configuration

### Claude Code (.mcp.json)

```json
{
  "mcpServers": {
    "devtools": {
      "command": "npx",
      "args": ["@anthropic-ai/devtools-mcp"]
    },
    "chrome-profiler": {
      "command": "node",
      "args": ["./chrome-function-profiler/build/index.js"],
      "env": {
        "CHROME_DEBUG_PORT": "9222"
      }
    }
  }
}
```

### Chrome launch requirements

Chrome must be started with remote debugging enabled:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Or for Edge
msedge --remote-debugging-port=9222
```

---

## Implementation Order

### Phase 1: Core (Connect + Marks-Mode CPU Profiling + Comparison)

The user drives all interactions manually. The tool watches and captures.

1. **CDP connection manager** (`cdp/connection.ts`)
   - Connect to Chrome debug port via DI (not module-level singleton)
   - Auto-attach to workers
   - Track sessions
   - Handle CDP disconnection gracefully

2. **Mark patcher** (`instrumentation/mark-patcher.ts`)
   - Inject `performance.mark` patch via `Runtime.evaluate`
   - `console.profile()`/`console.profileEnd()` for zero-latency start/stop
   - Re-entrancy depth tracking with overlap annotation
   - Restoration logic

3. **Navigation handler** (`instrumentation/navigation-handler.ts`)
   - Listen for `Runtime.executionContextCreated`
   - Re-inject mark patch into new contexts
   - Detect and warn about interrupted captures

4. **CPU profiler** (`profilers/cpu-profiler.ts`)
   - `Profiler.enable` + `setSamplingInterval` configuration
   - Listen for `consoleProfileStarted`/`consoleProfileFinished` events
   - Save .cpuprofile format
   - Basic summary (duration, top functions by hitCount)

5. **Stats utility** (`utils/stats.ts`)
   - Percentile, min, max, avg, stddev calculations
   - Outlier detection (z-score)

6. **Profiling session manager** (`session/profiling-session.ts`)
   - Start session: inject patch + listen for events
   - Accumulate captures on each `consoleProfileFinished`
   - Auto-label via `Runtime.evaluate`
   - Session timeout for leak prevention
   - Stop session: restore + summarize

7. **Profile comparator** (`analysis/profile-comparator.ts`)
   - Parse and diff two .cpuprofile files
   - Aggregate by function name
   - Sort by delta

8. **MCP server with tools**: `connect`, `disconnect`, `list_targets`, `profile_scenario`, `start_profiling_session`, `stop_profiling_session`, `compare_profiles`

**Milestone**: Connect to Chrome. Tell Claude "profile the scenario between transform-start and transform-end marks." Click through 10 channels manually. Say "done." Get a summary with per-channel CPU profiles, stats, and outliers. Compare the slowest against the fastest. All .cpuprofile files loadable in DevTools.

### Phase 2: Network Capture + Analysis

9. **Network capture** (`profilers/network-capture.ts`)
   - Windowed capture (open on `consoleProfileStarted`, close on `consoleProfileFinished`)
   - GraphQL operation name extraction from POST body
   - Request/response metadata collection

10. **Summary generator** (`analysis/summary-generator.ts`)
    - Correlation analysis (CPU duration vs network payload size)
    - First visit vs revisit pattern detection
    - Framework vs app code time breakdown (by URL classification)
    - Actionable optimization suggestions

11. **Tool**: `analyze_profiles`

**Milestone**: Same workflow as Phase 1 but now captures correlated network activity per invocation and generates deeper analysis with actionable suggestions.

### Phase 3: Measure Mode Fallback

12. **Measure observer** (`instrumentation/measure-observer.ts`)
    - PerformanceObserver injection for measure-only mode
    - `Runtime.addBinding` for measure signal delivery
    - Time base calibration (capture `performance.now()` at arm time)
    - Profile trimming with calibrated offsets

13. **Extend profiling session** to support `instrumentationMode: "performance-measure"`

**Milestone**: Users who only have `performance.measure` names (no mark names) can still profile, with caveats about pre-arming overhead documented.

### Phase 4 (Future): Memory Profiling

14. **Memory profiler** (`profilers/memory-profiler.ts`)
    - `HeapProfiler.startSampling/stopSampling` wrapper
    - Use `Runtime.getHeapUsage()` for heap size measurement (works in workers, unlike `performance.memory`)
    - GC-before-and-after for retention measurement (`HeapProfiler.collectGarbage()`)
    - Save .heapprofile format
    - Allocation tree summary

15. **Memory analysis** (`analysis/memory-diff.ts`)
    - Heap growth trend analysis across session captures
    - Cumulative leak detection

**Milestone**: Same workflow but now captures memory allocations and heap growth trends per invocation.

### Phase 5 (Future): Interaction Automation

16. **Interaction recording**: Record user clicks into generic, reusable scripts
17. **Interaction replay**: Replay scripts with profiling
18. **Tools**: `record_interactions`, `replay_with_profiling`

**Milestone**: Record a channel-switching workflow once, share the script across the team, anyone can replay it with profiling.

---

## Edge Cases and Error Handling

### Marks never fire
If the session timeout expires without any `consoleProfileFinished` events, clean up the patch and return: "No scenarios were captured within the timeout. The marks '{startMark}'/'{endMark}' may not have fired. Verify the mark names are correct and that the scenario was triggered."

### Worker destroyed mid-profile
Workers can be terminated. Listen for `Target.detachedFromTarget` and handle gracefully: if there was an active `console.profile()` in that worker, log a warning that the capture was interrupted. The `consoleProfileFinished` event will not fire; detect this via the `consoleProfileStarted` without a matching finish.

### Re-entrant / overlapping invocations
Handled by the depth counter in the injected code. Only the outermost start/stop pair triggers profiling. The overlap count is annotated on the capture. Claude reports overlapping captures with a note that the profile reflects merged work.

### Page navigation during profiling
Handled by `Runtime.executionContextCreated` listener. The mark patch is re-injected. Any in-flight capture is logged as interrupted. Bindings from `Runtime.addBinding` (measure mode only) survive navigations.

### CDP connection lost
Listen for WebSocket close events. If the connection drops during an active session, report the error and save any captures accumulated so far.

### Profiler already running
If DevTools is also profiling, or another tool started the Profiler, `console.profile()` may interact with existing profiles. V8 supports multiple concurrent named profiles via `console.profile(title)`, so this should work. However, if the profiler was started via `Profiler.start()` (not `console.profile`), there may be interaction. Test and document this.

### `console.profileEnd()` title mismatch
`console.profileEnd()` ends the most recently started profile regardless of the title passed. Since our depth counter ensures only one `console.profile()` is active at a time, this is safe. The title in `consoleProfileFinished` is the one from the matching `console.profile()` call, not the `profileEnd()` call. **Verify this behavior during implementation.**

### Multiple workers with same URL pattern
`findWorkerSessions` returns all matches. `list_targets` displays them with indices. The user specifies a more precise `workerUrl` to disambiguate.

---

## Assumptions to Verify During Implementation

These behaviors are expected based on CDP documentation and V8 internals but should be verified with actual Chrome:

1. **`Profiler.setSamplingInterval()` affects `console.profile()` profiles**: Expected because they share the same V8 `CpuProfiler` instance, but not explicitly documented.

2. **`console.profile()` / `console.profileEnd()` work in Web Workers**: The Console API is available in workers, and `consoleProfileStarted`/`consoleProfileFinished` events should fire on the worker's flattened CDP session.

3. **`console.profileEnd(title)` behavior with mismatched titles**: Expected to end the most recent profile regardless of title. The `consoleProfileFinished` event should contain the title from the matching `console.profile()` call.

4. **`performance.mark` is writable**: Expected on all browsers, as it's a regular method on the `Performance` prototype, not frozen or accessor-defined. Verify in workers too.

5. **Multiple `console.profile()` sessions don't interfere**: V8 supports multiple named profiling sessions. Our depth counter ensures at most one is active, but verify there's no issue with the `Profiler` domain state.

---

## Demo App: Chat Channel Viewer

A Vite + React app that simulates a chat messaging interface. The app has intentionally inefficient code paths that produce meaningful variance across channels — making it ideal for validating the profiler and, later, for testing optimization recommendations.

### Project Structure

```
demo-app/
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Root layout: sidebar + message pane
│   ├── components/
│   │   ├── ChannelList.tsx         # Sidebar with ~15 channels
│   │   ├── MessagePane.tsx         # Renders messages for selected channel
│   │   ├── Message.tsx             # Single message component
│   │   └── StatusBar.tsx           # Shows last scenario duration
│   ├── worker/
│   │   ├── data-worker.ts          # Web Worker: generates + transforms messages
│   │   ├── generator.ts            # Synthetic message generation
│   │   └── pipeline.ts             # Transform pipeline (the intentionally heavy code)
│   ├── hooks/
│   │   └── useChannelData.ts       # Hook that talks to the worker
│   └── types.ts                    # Shared types
└── tsconfig.json
```

### Data Model

```typescript
// types.ts

interface Channel {
  id: string;
  name: string;
  messageCount: number;    // Varies: 50 to 5000 — drives fast/slow variance
  hasThreads: boolean;     // Channels with threads trigger nested processing
  category: 'small' | 'medium' | 'large' | 'huge';
}

interface RawMessage {
  id: string;
  authorId: string;
  content: string;         // Raw markdown with @mentions, :emoji:, URLs
  timestamp: number;
  threadId?: string;
  reactions: { emoji: string; userIds: string[] }[];
  attachments: { type: string; url: string; size: number }[];
}

interface ProcessedMessage {
  id: string;
  author: { id: string; name: string; avatar: string };
  contentHtml: string;     // Parsed markdown → HTML
  mentions: string[];      // Resolved @mentions
  emojis: string[];        // Decoded :emoji: → unicode
  timestamp: number;
  formattedTime: string;
  dateGroup: string;       // "Today", "Yesterday", "Feb 12"
  threadMessages?: ProcessedMessage[];
  reactionSummary: { emoji: string; count: number; names: string[] }[];
}
```

### Channel Configuration

The channels are designed to produce natural variance in profiling:

```typescript
const CHANNELS: Channel[] = [
  // Small channels — fast scenarios (<10ms)
  { id: 'general',       name: 'General',        messageCount: 50,   hasThreads: false, category: 'small' },
  { id: 'random',        name: 'Random',         messageCount: 80,   hasThreads: false, category: 'small' },
  { id: 'introductions', name: 'Introductions',  messageCount: 30,   hasThreads: false, category: 'small' },

  // Medium channels — moderate scenarios (10-50ms)
  { id: 'engineering',   name: 'Engineering',     messageCount: 500,  hasThreads: true,  category: 'medium' },
  { id: 'design',        name: 'Design',          messageCount: 400,  hasThreads: true,  category: 'medium' },
  { id: 'product',       name: 'Product',         messageCount: 350,  hasThreads: false, category: 'medium' },
  { id: 'standup',       name: 'Standup',         messageCount: 200,  hasThreads: false, category: 'medium' },
  { id: 'frontend',      name: 'Frontend',        messageCount: 600,  hasThreads: true,  category: 'medium' },
  { id: 'backend',       name: 'Backend',         messageCount: 450,  hasThreads: true,  category: 'medium' },

  // Large channels — slow scenarios (50-150ms)
  { id: 'support',       name: 'Support',         messageCount: 2000, hasThreads: true,  category: 'large' },
  { id: 'incidents',     name: 'Incidents',        messageCount: 1500, hasThreads: true,  category: 'large' },
  { id: 'design-review', name: 'Design Review',   messageCount: 3000, hasThreads: true,  category: 'large' },

  // Huge channels — outlier scenarios (150ms+)
  { id: 'all-hands',     name: 'All Hands',       messageCount: 5000, hasThreads: true,  category: 'huge' },
  { id: 'announcements', name: 'Announcements',   messageCount: 4000, hasThreads: true,  category: 'huge' },
  { id: 'firehose',      name: 'Firehose',        messageCount: 5000, hasThreads: false, category: 'huge' },
];
```

### Worker: Data Generation + Transform Pipeline

The worker generates synthetic messages and runs them through a deliberately inefficient transform pipeline. The inefficiencies are realistic — the kind you'd find in a real codebase that grew organically.

```typescript
// worker/data-worker.ts

import { generateMessages } from './generator';
import { transformPipeline } from './pipeline';

self.onmessage = (event: MessageEvent) => {
  const { channelId, messageCount, hasThreads } = event.data;

  // Mark the worker-side processing scenario
  performance.mark('worker-process-start');

  // Step 1: Generate synthetic raw messages
  const rawMessages = generateMessages(channelId, messageCount, hasThreads);

  // Step 2: Run through the transform pipeline (the heavy/inefficient part)
  const processed = transformPipeline(rawMessages, hasThreads);

  performance.mark('worker-process-end');

  // Post result back to main thread
  self.postMessage({ channelId, messages: processed });
};
```

```typescript
// worker/generator.ts

const USERS = [
  { id: 'u1', name: 'Alice Chen', avatar: 'ac' },
  { id: 'u2', name: 'Bob Martinez', avatar: 'bm' },
  { id: 'u3', name: 'Carol Wang', avatar: 'cw' },
  // ... 20 users total
];

const EMOJI_NAMES = ['thumbsup', 'heart', 'fire', 'rocket', 'eyes', 'tada', 'thinking', '100', 'wave', 'pray'];

export function generateMessages(channelId: string, count: number, hasThreads: boolean): RawMessage[] {
  const messages: RawMessage[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const author = USERS[i % USERS.length];
    const hasThread = hasThreads && i % 7 === 0; // Every 7th message starts a thread

    messages.push({
      id: `${channelId}-msg-${i}`,
      authorId: author.id,
      content: generateMessageContent(i, channelId),
      timestamp: now - (count - i) * 60000, // 1 message per minute going back
      threadId: hasThread ? `thread-${channelId}-${i}` : undefined,
      reactions: generateReactions(i),
      attachments: i % 13 === 0 ? [{ type: 'image', url: `/img/${i}.png`, size: 245000 }] : [],
    });

    // Add thread replies
    if (hasThread) {
      const replyCount = 3 + (i % 5); // 3-7 replies per thread
      for (let r = 0; r < replyCount; r++) {
        messages.push({
          id: `${channelId}-msg-${i}-reply-${r}`,
          authorId: USERS[(i + r + 1) % USERS.length].id,
          content: generateMessageContent(i * 100 + r, channelId),
          timestamp: now - (count - i) * 60000 + (r + 1) * 30000,
          threadId: `thread-${channelId}-${i}`,
          reactions: r % 3 === 0 ? generateReactions(r) : [],
          attachments: [],
        });
      }
    }
  }

  return messages;
}

function generateMessageContent(seed: number, channelId: string): string {
  // Mix of plain text, @mentions, :emoji:, URLs, and markdown
  const templates = [
    `Hey @user${seed % 20}, check out this **update** to the ${channelId} workflow :rocket:`,
    `I think we should reconsider the approach here. See https://example.com/doc/${seed} for details :thinking:`,
    `@user${(seed + 3) % 20} @user${(seed + 7) % 20} can you review this?\n\n\`\`\`javascript\nconst result = processData(${seed});\nconsole.log(result);\n\`\`\``,
    `:thumbsup: Looks good to me! Ship it :rocket: :tada:`,
    `Here's the summary:\n- Item 1: completed :white_check_mark:\n- Item 2: in progress\n- Item 3: blocked by @user${seed % 20}`,
  ];
  return templates[seed % templates.length];
}

function generateReactions(seed: number): RawMessage['reactions'] {
  if (seed % 4 !== 0) return [];
  const count = 1 + (seed % 3);
  return Array.from({ length: count }, (_, i) => ({
    emoji: EMOJI_NAMES[(seed + i) % EMOJI_NAMES.length],
    userIds: Array.from({ length: 1 + (seed % 5) }, (_, j) => `u${(seed + j) % 20}`),
  }));
}
```

### Transform Pipeline (Intentionally Inefficient)

This is the code the profiler will reveal as slow. Each inefficiency is the kind that occurs naturally in real codebases. The profiler should help identify these, and eventually the optimization skill can suggest fixes.

```typescript
// worker/pipeline.ts

export function transformPipeline(messages: RawMessage[], hasThreads: boolean): ProcessedMessage[] {
  // INEFFICIENCY 1: Unnecessary full copy via JSON round-trip
  // Real codebases do this "just to be safe" or for deep cloning
  const cloned = JSON.parse(JSON.stringify(messages));

  // INEFFICIENCY 2: Multiple passes over the array instead of single pass
  const normalized = normalizeMessages(cloned);
  const enriched = enrichMessages(normalized);
  const sorted = sortMessages(enriched);
  const grouped = groupByDate(sorted);
  const withThreads = hasThreads ? nestThreads(grouped) : grouped;
  const withReactions = resolveReactions(withThreads);

  return withReactions;
}

function normalizeMessages(messages: any[]): any[] {
  // INEFFICIENCY 3: .map() creating new objects when mutation would suffice
  // Plus redundant string operations
  return messages.map(msg => ({
    ...msg,
    content: msg.content.trim().replace(/\s+/g, ' '),  // Already clean, but normalizes anyway
    authorId: msg.authorId.toLowerCase().trim(),         // Already lowercase
    id: msg.id.toString(),                               // Already a string
  }));
}

function enrichMessages(messages: any[]): ProcessedMessage[] {
  // INEFFICIENCY 4: Resolving author for every message (no lookup cache)
  // Real apps often have a getUser() call that isn't memoized
  return messages.map(msg => {
    const author = resolveAuthor(msg.authorId);      // O(n) lookup each time
    const contentHtml = parseMarkdown(msg.content);  // Regex-heavy, allocates many strings
    const mentions = extractMentions(msg.content);   // Another pass over the same string
    const emojis = decodeEmojis(msg.content);        // Yet another pass

    return {
      ...msg,
      author,
      contentHtml,
      mentions,
      emojis,
      formattedTime: formatTimestamp(msg.timestamp), // Creates Date object each time
      dateGroup: getDateGroup(msg.timestamp),         // Creates another Date object
      reactionSummary: [],
    };
  });
}

function resolveAuthor(authorId: string): { id: string; name: string; avatar: string } {
  // INEFFICIENCY 5: Linear scan of user list for every message
  // No Map/cache, just Array.find() every time
  const users = [
    { id: 'u1', name: 'Alice Chen', avatar: 'ac' },
    { id: 'u2', name: 'Bob Martinez', avatar: 'bm' },
    { id: 'u3', name: 'Carol Wang', avatar: 'cw' },
    { id: 'u4', name: 'David Kim', avatar: 'dk' },
    { id: 'u5', name: 'Eva Gonzalez', avatar: 'eg' },
    { id: 'u6', name: 'Frank Liu', avatar: 'fl' },
    { id: 'u7', name: 'Grace Park', avatar: 'gp' },
    { id: 'u8', name: 'Hiro Tanaka', avatar: 'ht' },
    { id: 'u9', name: 'Iris Novak', avatar: 'in' },
    { id: 'u10', name: 'Jake Wilson', avatar: 'jw' },
    { id: 'u11', name: 'Kara Johnson', avatar: 'kj' },
    { id: 'u12', name: 'Leo Smith', avatar: 'ls' },
    { id: 'u13', name: 'Maya Patel', avatar: 'mp' },
    { id: 'u14', name: 'Noah Brown', avatar: 'nb' },
    { id: 'u15', name: 'Olivia Davis', avatar: 'od' },
    { id: 'u16', name: 'Paul Garcia', avatar: 'pg' },
    { id: 'u17', name: 'Quinn Taylor', avatar: 'qt' },
    { id: 'u18', name: 'Ruby Anderson', avatar: 'ra' },
    { id: 'u19', name: 'Sam Thomas', avatar: 'st' },
    { id: 'u20', name: 'Tina Martin', avatar: 'tm' },
  ];
  // Array is re-created on every call too (allocation pressure)
  return users.find(u => u.id === authorId) || { id: authorId, name: 'Unknown', avatar: '??' };
}

function parseMarkdown(content: string): string {
  // INEFFICIENCY 6: Sequential regex replacements, each creating new strings
  // A real app might use a full markdown parser, but this simulates the cost
  let html = content;
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>');
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  html = html.replace(/\n/g, '<br>');

  // INEFFICIENCY 7: Re-process the string to handle line items
  // (could be done in a single pass with the above)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

  return html;
}

function extractMentions(content: string): string[] {
  // INEFFICIENCY 8: Regex + filter + map chain with intermediate arrays
  const matches = content.match(/@user\d+/g) || [];
  return matches
    .map(m => m.slice(1))            // Remove @
    .filter((v, i, a) => a.indexOf(v) === i)  // Dedupe via indexOf (O(n²))
    .map(userId => resolveAuthor(userId).name);  // Another author lookup per mention!
}

function decodeEmojis(content: string): string[] {
  // INEFFICIENCY 9: Regex matching + lookup table rebuilt on every call
  const emojiMap: Record<string, string> = {
    'thumbsup': '👍', 'heart': '❤️', 'fire': '🔥', 'rocket': '🚀',
    'eyes': '👀', 'tada': '🎉', 'thinking': '🤔', '100': '💯',
    'wave': '👋', 'pray': '🙏', 'white_check_mark': '✅',
  };
  const matches = content.match(/:(\w+):/g) || [];
  return matches.map(m => {
    const name = m.slice(1, -1);
    return emojiMap[name] || m;
  });
}

function formatTimestamp(ts: number): string {
  // INEFFICIENCY 10: Creating Intl.DateTimeFormat on every call
  // (should be cached/shared)
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts));
}

function getDateGroup(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  // INEFFICIENCY 11: Another Intl.DateTimeFormat created per call
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function sortMessages(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 12: Sort by timestamp (number comparison via string coercion)
  // The classic: a.timestamp - b.timestamp would be faster, but this uses localeCompare
  return [...messages].sort((a, b) =>
    new Date(a.timestamp).toISOString().localeCompare(new Date(b.timestamp).toISOString())
  );
}

function groupByDate(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 13: reduce + spread accumulator pattern (O(n²) copies)
  return messages.reduce((acc, msg) => {
    return [...acc, msg]; // Spreading the entire accumulator each iteration
  }, [] as ProcessedMessage[]);
}

function nestThreads(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 14: O(n²) thread nesting — for each parent, filter all messages
  const parents = messages.filter(m => !m.id.includes('-reply-'));
  return parents.map(parent => {
    if (!parent.id.includes('thread')) return parent;
    const threadId = `thread-${parent.id.split('-msg-')[0]}-${parent.id.split('-msg-')[1]}`;
    // Filter ALL messages for each parent (should build a Map once)
    const replies = messages.filter(m => m.id.includes('-reply-') && m.id.startsWith(parent.id));
    return { ...parent, threadMessages: replies };
  });
}

function resolveReactions(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 15: For each message, re-resolve all reactor names via resolveAuthor
  return messages.map(msg => {
    if (!msg.reactions || msg.reactions.length === 0) return msg;
    return {
      ...msg,
      reactionSummary: msg.reactions.map(r => ({
        emoji: decodeEmojis(`:${r.emoji}:`)[0] || r.emoji,
        count: r.userIds.length,
        names: r.userIds.map(uid => resolveAuthor(uid).name), // Author lookup per reactor
      })),
    };
  });
}
```

### Main Thread: React Components with Performance Marks

```tsx
// hooks/useChannelData.ts

import { useState, useCallback, useRef } from 'react';
import type { ProcessedMessage, Channel } from '../types';

const worker = new Worker(
  new URL('../worker/data-worker.ts', import.meta.url),
  { type: 'module' }
);

export function useChannelData() {
  const [messages, setMessages] = useState<ProcessedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const resolveRef = useRef<((msgs: ProcessedMessage[]) => void) | null>(null);

  const loadChannel = useCallback((channel: Channel) => {
    // === SCENARIO: channel-switch ===
    performance.mark('channel-switch-start');
    setLoading(true);

    // Request data from worker
    worker.postMessage({
      channelId: channel.id,
      messageCount: channel.messageCount,
      hasThreads: channel.hasThreads,
    });

    // Wait for worker response
    return new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data.channelId !== channel.id) return;
        worker.removeEventListener('message', handler);

        const workerMessages = event.data.messages;

        // Main thread rendering work (also intentionally heavy)
        performance.mark('render-start');
        renderMessages(workerMessages);
        performance.mark('render-end');
        performance.measure('render-duration', 'render-start', 'render-end');

        setMessages(workerMessages);
        setLoading(false);

        // End the full channel-switch scenario
        performance.mark('channel-switch-end');
        const measure = performance.measure(
          'channel-switch-duration',
          'channel-switch-start',
          'channel-switch-end'
        );
        setLastDuration(measure.duration);

        resolve();
      };
      worker.addEventListener('message', handler);
    });
  }, []);

  return { messages, loading, loadChannel, lastDuration };
}

// Main-thread processing that adds to the scenario cost
function renderMessages(messages: ProcessedMessage[]): void {
  // INEFFICIENCY 16: Pre-compute layout data that React will compute again
  // Simulates the kind of redundant work that happens in real render pipelines
  for (const msg of messages) {
    // Force string concatenation to simulate template computation
    const _html = `<div class="msg" data-id="${msg.id}">` +
      `<span class="author">${msg.author.name}</span>` +
      `<span class="time">${msg.formattedTime}</span>` +
      `<div class="content">${msg.contentHtml}</div>` +
      (msg.reactionSummary.length > 0
        ? `<div class="reactions">${msg.reactionSummary.map(r =>
            `<span>${r.emoji} ${r.count}</span>`
          ).join('')}</div>`
        : '') +
      `</div>`;
  }
}
```

```tsx
// App.tsx

import { useState } from 'react';
import { ChannelList } from './components/ChannelList';
import { MessagePane } from './components/MessagePane';
import { StatusBar } from './components/StatusBar';
import { useChannelData } from './hooks/useChannelData';
import { CHANNELS } from './channels';

export function App() {
  const [selectedChannel, setSelectedChannel] = useState(CHANNELS[0]);
  const { messages, loading, loadChannel, lastDuration } = useChannelData();

  const handleChannelSelect = (channel: Channel) => {
    setSelectedChannel(channel);
    loadChannel(channel);
  };

  return (
    <div className="app">
      <ChannelList
        channels={CHANNELS}
        selected={selectedChannel}
        onSelect={handleChannelSelect}
      />
      <MessagePane
        channel={selectedChannel}
        messages={messages}
        loading={loading}
      />
      <StatusBar
        channel={selectedChannel}
        duration={lastDuration}
        messageCount={messages.length}
      />
    </div>
  );
}
```

```tsx
// components/ChannelList.tsx

export function ChannelList({ channels, selected, onSelect }) {
  return (
    <nav className="channel-list" role="tree">
      <h2>Channels</h2>
      {channels.map(channel => (
        <button
          key={channel.id}
          role="treeitem"
          aria-selected={channel.id === selected.id}
          className={channel.id === selected.id ? 'active' : ''}
          onClick={() => onSelect(channel)}
        >
          <span className="channel-name"># {channel.name}</span>
          <span className="channel-count">{channel.messageCount}</span>
        </button>
      ))}
    </nav>
  );
}
```

### Performance Marks Summary

The demo app ships with these marks baked in — the profiler hooks into them:

| Start Mark | End Mark | Where | What it measures |
|-----------|---------|-------|-----------------|
| `channel-switch-start` | `channel-switch-end` | Main thread (`useChannelData.ts`) | Full channel switch: worker request + response + render |
| `worker-process-start` | `worker-process-end` | Worker (`data-worker.ts`) | Worker-side data generation + transform pipeline |
| `render-start` | `render-end` | Main thread (`useChannelData.ts`) | Main-thread message rendering work only |

The `channel-switch-duration` and `render-duration` measures are also created (via `performance.measure`) for the measure-mode fallback testing.

### Validation Scenarios

The demo app enables testing all profiler scenarios:

| Scenario | How to trigger | What it validates |
|----------|---------------|-------------------|
| **Single fast capture** | Click "General" (50 msgs) | `profile_scenario` with small profile, <10ms |
| **Single slow capture** | Click "All Hands" (5000 msgs) | `profile_scenario` with large profile, 150ms+ |
| **Multi-capture session** | Click through all 15 channels | `start/stop_profiling_session` — 15 captures with natural variance |
| **Fast → slow variance** | Click General then All Hands | `compare_profiles` — identify pipeline functions that scale with message count |
| **First visit vs revisit** | Click General, then General again | Pattern detection: first visit slower (no cache), revisit should be same (no caching in this app = bug to find) |
| **Worker profiling** | Profile with `target: "worker"`, marks `worker-process-start`/`worker-process-end` | Worker session discovery, worker-scoped profiling |
| **Re-entrant marks** | Rapidly click multiple channels | Depth counter, overlap annotation, merged profiles |
| **Outlier detection** | Click 10 small channels + 1 huge channel | Outlier shows in summary with z-score |
| **Network correlation** | Enable `captureNetwork` during session | Correlate CPU duration with worker message payload size |
| **Measure mode fallback** | Use `measureName: "channel-switch-duration"` | Measure mode with time base calibration + trimming |
| **Navigation** | Add a "Reload" button that reloads the page mid-session | Navigation handler re-injects the mark patch |

### Catalog of Intentional Inefficiencies

These are the performance issues the profiler should reveal. Each is numbered and commented in the code for reference:

| # | Inefficiency | Location | Impact | What profiler shows |
|---|-------------|----------|--------|-------------------|
| 1 | JSON.parse(JSON.stringify()) deep clone | `pipeline.ts:transformPipeline` | O(n) allocation + serialization | High self-time in JSON.parse/stringify |
| 2 | Multiple array passes instead of single pass | `pipeline.ts:transformPipeline` | 6 passes over messages array | Multiple flatMap/map nodes in profile |
| 3 | Unnecessary .map() creating new objects | `pipeline.ts:normalizeMessages` | Allocation pressure | Object spread shows in allocators |
| 4 | No author lookup cache | `pipeline.ts:enrichMessages` | O(n×m) per message batch | resolveAuthor appears as hotspot |
| 5 | Array.find() with re-created array | `pipeline.ts:resolveAuthor` | Array literal allocation + linear scan per call | resolveAuthor self-time dominates |
| 6 | Sequential regex replacements | `pipeline.ts:parseMarkdown` | 7 string allocations per message | String replacement in profile |
| 7 | Re-processing string for line items | `pipeline.ts:parseMarkdown` | Extra regex pass | Additional regex time in same function |
| 8 | indexOf dedupe (O(n²)) | `pipeline.ts:extractMentions` | Quadratic on mentions | Visible in slow channels with many mentions |
| 9 | Emoji map rebuilt per call | `pipeline.ts:decodeEmojis` | Object literal allocation pressure | Allocation in decodeEmojis |
| 10 | Intl.DateTimeFormat created per call | `pipeline.ts:formatTimestamp` | Expensive constructor | formatTimestamp self-time |
| 11 | Another DateTimeFormat per call | `pipeline.ts:getDateGroup` | Same as above | getDateGroup self-time |
| 12 | Sort via Date→ISO string→localeCompare | `pipeline.ts:sortMessages` | O(n log n) with expensive comparator | sort comparator in profile |
| 13 | reduce + spread accumulator O(n²) | `pipeline.ts:groupByDate` | Quadratic copies | Massive allocation in groupByDate for large channels |
| 14 | O(n²) thread nesting | `pipeline.ts:nestThreads` | filter() inside map() | nestThreads dominates for threaded channels |
| 15 | Reaction name resolution per reactor | `pipeline.ts:resolveReactions` | resolveAuthor called per reactor per message | resolveAuthor appears again in profile |
| 16 | Redundant template pre-computation | `useChannelData.ts:renderMessages` | String concatenation main thread work | renderMessages self-time on main thread |

### How to Run

```bash
cd demo-app
npm install
npm run dev
# Opens at http://localhost:5173
```

Then launch Chrome with debugging:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 http://localhost:5173
```

---

## Testing Strategy

### Using the demo app

The demo app IS the primary test fixture. Use it for both manual and automated testing.

### Manual testing

Verify with the demo app:
- Main thread profiling captures the correct work (channel-switch marks)
- Worker profiling captures the correct work (worker-process marks)
- Re-entrant scenarios produce one merged profile with overlap annotation
- Navigation during profiling re-injects the patch
- .cpuprofile files are valid and loadable in DevTools
- Summary stats are mathematically correct
- Compare tool produces meaningful diffs (General vs All Hands shows pipeline hotspots)
- Small channels are fast, large channels are slow (natural variance)
- Outlier detection correctly flags huge channels

### Integration tests

Use Puppeteer to launch Chrome with `--remote-debugging-port`, load the demo app, then run the MCP tools programmatically. Verify:
- .cpuprofile files are valid JSON with expected structure
- Profile duration roughly matches expected execution time (small <10ms, huge >150ms)
- Worker sessions are properly discovered
- `performance.mark` restoration works (original behavior preserved)
- Session timeout triggers correctly
- CDP disconnection handling works
- Rapid channel clicks don't break the profiler (re-entrancy)

---

## Natural Language Usage Examples

**Example 1: Basic multi-channel profiling**

> **User**: "Profile transformMessages across channel switches"
>
> **Claude**: "What are the performance.mark names that bracket the transformMessages scenario?"
>
> **User**: "performance.mark('transform-start') and performance.mark('transform-end')"
>
> **Claude**: Calls `connect`, then `start_profiling_session` with `startMark: "transform-start"`, `endMark: "transform-end"`
>
> **Claude**: "Session started. I'm capturing a CPU profile every time the scenario between 'transform-start' and 'transform-end' fires. Go ahead and click through your channels. Tell me when you're done."
>
> **User**: *clicks through 10 channels manually*
>
> **User**: "Done"
>
> **Claude**: Calls `stop_profiling_session`. Gets back summary with 10 captures.
>
> **Claude**: "Captured 10 invocations. Design Review was the outlier at 120ms (avg was 45ms). First visits averaged 65ms, revisits 10ms. Want me to compare the Design Review profile against General to see what's different?"

**Example 2: Comparing specific captures**

> **User**: "What's different about Design Review that makes it slow?"
>
> **Claude**: Calls `compare_profiles` with the Design Review and General .cpuprofile files
>
> **Claude**: "The top difference is flatMap in normalizeResponse taking 45ms in Design Review vs 2ms in General. The response payload for Design Review was 245KB vs 12KB. The CPU time correlates almost perfectly with payload size (r=0.92). The bottleneck is deserialization, not rendering."

**Example 3: Worker profiling**

> **User**: "Profile the data processing in the CDL worker"
>
> **Claude**: Calls `list_targets` to discover workers
>
> **Claude**: "I see a worker at 'cdl-worker.js'. What are the performance.mark names for the data processing scenario?"
>
> **User**: "process-start and process-end"
>
> **Claude**: Calls `start_profiling_session` with `target: "worker"`, `workerUrl: "cdl"`, `startMark: "process-start"`, `endMark: "process-end"`

---

## Claude Code Skill: `/perf-profile`

A Claude Code skill that orchestrates the profiling workflow. The user invokes it with `/perf-profile` and Claude guides them through connection, mark discovery, capture mode selection, the profiling session, and result presentation.

### Skill File

Location: `.claude/skills/perf-profile.md`

```markdown
---
name: perf-profile
description: Profile a scenario in Chrome using the chrome-function-profiler MCP server. Guides the user through connecting, identifying performance marks, choosing single or multi-capture mode, running the session, and presenting results with hotspot analysis.
---

# /perf-profile

You are orchestrating a CPU profiling session using the chrome-function-profiler MCP tools.

## Workflow

Follow these steps in order. Do NOT skip steps. Ask the user at each decision point.

### Step 1: Connection

Check if already connected to Chrome. If not:
- Call the `connect` tool (default port 9222)
- If connection fails, tell the user to launch Chrome with `--remote-debugging-port=9222`
- Call `list_targets` to show available targets (main thread, workers)

### Step 2: Scenario Identification

Ask the user:
1. "What scenario do you want to profile?" (e.g., channel switching, data loading, form submission)
2. "What are the `performance.mark` names that bracket this scenario?"
   - They need a start mark and an end mark
   - If the user doesn't know, suggest they check their codebase or add marks
   - If they only have a `performance.measure` name, note that measure mode is a fallback with caveats (pre-armed profiler, less precise)

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
  captureNetwork: true
)
```

**Multi-capture:**
```
start_profiling_session(
  startMark: "<user's start mark>",
  endMark: "<user's end mark>",
  target: "main" | "worker",
  workerUrl: "<if worker>",
  captureNetwork: true
)
```

Tell the user: "Profiler armed. Go ahead and interact with the app. I'll capture a profile every time the scenario fires. Tell me when you're done."

### Step 5: Wait + Capture

Wait for the user to say they're done.

- **Single capture**: The tool returns automatically after one capture.
- **Multi-capture**: Call `stop_profiling_session` when the user says "done."

### Step 6: Present Results

Present the results clearly:

1. **Summary table**: Show each capture with label, duration, and whether it had overlapping invocations
2. **Stats**: min, max, avg, p50, p95 durations
3. **Outliers**: Flag any captures > 2 stddev from mean with their labels
4. **Patterns**: First visit vs revisit, cumulative degradation, network correlation
5. **File locations**: Where the .cpuprofile files are saved

Format the summary as a readable table, not raw JSON.

### Step 7: Offer Next Steps

After presenting results, offer these options:

1. **Compare profiles**: "Want me to compare the slowest capture against the fastest to identify which functions are responsible?"
   - If yes: call `compare_profiles` with the two files
   - Present the diff as a table: function name, file, line, time in fast, time in slow, delta

2. **Investigate hotspots**: "Want me to look at the source code for the top hotspot functions and suggest optimizations?"
   - If yes: read the source files referenced in the profile's top functions (using URL + line number from the profile data)
   - Identify the inefficiency pattern (uncached lookups, O(n²) algorithms, redundant allocations, etc.)
   - Suggest specific code changes
   - Ask if the user wants you to apply the fixes

3. **Re-profile**: "Want to run the profiling session again (e.g., after making changes) to measure improvement?"
   - If yes: go back to Step 4

4. **Analyze deeper**: "Want me to run a full analysis across all captures?"
   - If yes: call `analyze_profiles` with the profile directory

## Guidelines

- Always ask for mark names. Never guess.
- Default to `captureNetwork: true` for multi-capture sessions.
- When presenting comparisons, focus on the top 5 differences — don't dump 20 rows.
- When suggesting source code fixes, always read the file first. Never suggest changes to code you haven't seen.
- If the user mentions a function name instead of mark names, ask: "What are the performance.mark names around that function?" Don't try to monkey-patch.
- If connection fails, don't retry repeatedly. Tell the user how to fix it.
- Keep the profiling overhead conversation simple. Don't explain console.profile internals unless asked.
```

### Skill Interaction Flow

```
User: /perf-profile

Claude: "Let me connect to Chrome and see what's available."
        → connect(), list_targets()
        "Connected. I see the main page at localhost:5173 and a worker at data-worker.ts.
         What scenario do you want to profile?"

User: "Channel switching performance"

Claude: "What are the performance.mark names that bracket the channel switch scenario?"

User: "channel-switch-start and channel-switch-end"

Claude: "Should I profile the main thread or the worker?"

User: "Main thread"

Claude: "Do you want to capture a single interaction or profile across multiple interactions?"

User: "Multiple — I want to click through several channels"

Claude: → start_profiling_session(startMark: "channel-switch-start", endMark: "channel-switch-end")
        "Profiler armed. Click through your channels. Tell me when you're done."

User: *clicks through 12 channels*
User: "Done"

Claude: → stop_profiling_session()
        "Captured 12 invocations:

         | #  | Channel        | Duration | Notes          |
         |----|---------------|----------|----------------|
         | 1  | General       | 8ms      |                |
         | 2  | Random        | 10ms     |                |
         | 3  | Engineering   | 42ms     |                |
         | 4  | Design        | 38ms     |                |
         | 5  | Support       | 95ms     |                |
         | 6  | Design Review | 128ms    | outlier (2.1σ) |
         | 7  | All Hands     | 185ms    | outlier (3.0σ) |
         | ...                                            |

         Stats: min=8ms, max=185ms, avg=54ms, p50=42ms, p95=185ms
         Pattern: Duration correlates strongly with message count (r=0.96)

         Profiles saved to ./profiles/session/

         What would you like to do next?
         1. Compare the fastest (General) vs slowest (All Hands) to find hotspots
         2. Look at the source code for the top hotspot functions
         3. Run a full analysis across all captures
         4. Re-profile after making changes"

User: "Compare fastest vs slowest"

Claude: → compare_profiles(profileA: "invocation-1.cpuprofile", profileB: "invocation-7.cpuprofile")
        "Top differences between General (8ms) and All Hands (185ms):

         | Function          | File          | Line | General | All Hands | Delta  |
         |-------------------|---------------|------|---------|-----------|--------|
         | groupByDate       | pipeline.ts   | 142  | 0.1ms   | 68ms      | +67.9ms|
         | resolveAuthor     | pipeline.ts   | 87   | 0.5ms   | 45ms      | +44.5ms|
         | nestThreads       | pipeline.ts   | 148  | 0ms     | 32ms      | +32ms  |
         | sortMessages      | pipeline.ts   | 135  | 0.1ms   | 18ms      | +17.9ms|
         | formatTimestamp   | pipeline.ts   | 120  | 0.2ms   | 12ms      | +11.8ms|

         The top bottleneck is groupByDate — it uses a reduce+spread pattern that's O(n²).
         With 5000 messages in All Hands, that's ~25 million array copies.

         Want me to look at the source code and suggest fixes?"

User: "Yes"

Claude: → reads pipeline.ts
        "Here's what I found in pipeline.ts:

         **groupByDate (line 142)** — O(n²) reduce+spread:
         ```
         return messages.reduce((acc, msg) => {
           return [...acc, msg]; // Copies entire array each iteration
         }, []);
         ```
         Fix: Use `push()` instead of spread, or just return the array directly since
         it's already sorted.

         **resolveAuthor (line 87)** — Array re-created + linear scan per call:
         The user array literal is inside the function body, so it's allocated on every
         call. And Array.find() is O(n) per lookup.
         Fix: Move the array outside the function and build a Map<string, User> once.

         Want me to apply these fixes?"
```

### Future Skill Extensions

The `/perf-profile` skill is designed to be the foundation for future skills:

- **`/perf-analyze`**: Deep analysis of existing profile directories. Correlation analysis, trend detection, framework vs app code breakdown.
- **`/perf-optimize`**: Takes profiler results, reads source code, applies fixes, re-profiles to verify. Full optimization loop.
- **`/perf-compare`**: Compare two profiling sessions (e.g., before/after a change) to quantify improvement.

---

## Future Considerations (Not in Scope)

- **Source map resolution**: Minified function names are not useful. Resolving `.map` files from source URLs in profiles would improve readability. Consider at analysis time using `Debugger.getScriptSource`.
- **iframes**: Cross-origin iframes are separate targets requiring their own sessions. Same-origin iframes share the main page context. `list_targets` should eventually enumerate iframe targets.
- **React DevTools integration**: Correlating React component render times with CPU profiles.
- **Chrome Trace Event format**: Richer output format loadable in `chrome://tracing`.
- **Framework vs app code attribution**: Classifying profile time by URL to show what percentage is framework code.
- **Conditional profiling**: "Profile only when response > 100KB."
