# Chrome Function Profiler MCP Server - Design

## Scope

Phase 1 (Core) + Demo App. CPU profiling only via marks-mode. No memory profiling, no measure-mode fallback.

## Decisions

- **CDP library**: `chrome-remote-interface` (lightweight, direct CDP access)
- **MCP transport**: stdio only (standard for Claude Code)
- **CDP assumptions**: Implement as designed, verify during testing against demo app
- **Implementation approach**: Parallel agent teams

## Architecture

An MCP server (Node.js, TypeScript) that connects to a running Chrome instance via CDP and provides scenario-scoped CPU profiling. Uses `console.profile()`/`console.profileEnd()` injected via a `performance.mark` patch for zero-latency profiler start/stop.

## Parallel Implementation Plan

### Wave 1 (fully parallel)

**Agent: demo-app** — Vite + React chat channel viewer with intentionally inefficient transform pipeline in a Web Worker. 15 channels with 50-5000 messages producing natural variance. Performance marks baked in.

**Agent: foundation** — Project scaffolding + CDP connection manager + session wrapper + worker manager + stats utility + profile comparator. All foundational pieces with no cross-dependencies.

**Agent: instrumentation** — `performance.mark` patcher (injects `console.profile`/`console.profileEnd`) + navigation handler (re-injects on context creation). The core mechanism.

### Wave 2 (depends on Wave 1)

**Agent: profiler-session** — CPU profiler event listener + profiling session manager + capture accumulator + file output. Composes foundation + instrumentation into the session workflow.

### Wave 3 (depends on Wave 2)

**Agent: mcp-server** — MCP server entry point with all tool definitions: `connect`, `disconnect`, `list_targets`, `profile_scenario`, `start_profiling_session`, `stop_profiling_session`, `compare_profiles`.

## Key Design Elements

- `console.profile()` starts V8 CPU profiler synchronously (zero IPC latency)
- Re-entrancy handled via depth counter with overlap annotation
- Navigation re-injection via `Runtime.executionContextCreated`
- Worker profiling via `Target.setAutoAttach({ flatten: true })`
- Auto-labeling captures via `Runtime.evaluate` querying active UI elements
- Session timeout for leak prevention
- .cpuprofile output loadable directly in Chrome DevTools

## Full Specification

See `chrome-function-profiler-plan.md` for complete details including CDP domains, injected code, edge cases, and error handling.
