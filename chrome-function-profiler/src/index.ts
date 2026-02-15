#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createConnection, listCDPTargets, type CDPConnection } from './cdp/connection.js';
import { WorkerManager } from './cdp/worker-manager.js';
import { ProfilingSession } from './session/profiling-session.js';
import { compareProfiles } from './analysis/profile-comparator.js';
import { topFunctions, profileDurationMs } from './analysis/profile-parser.js';
import { loadProfile, saveProfile } from './utils/file-output.js';
import { computeStats } from './utils/stats.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let connection: CDPConnection | null = null;
let workerManager: WorkerManager | null = null;
let activeSession: ProfilingSession | null = null;

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'chrome-function-profiler', version: '0.1.0' },
);

// ---------------------------------------------------------------------------
// Tool: connect
// ---------------------------------------------------------------------------

server.tool(
  'connect',
  'Connect to a Chrome instance via the Chrome DevTools Protocol.',
  {
    port: z.number().default(9222).describe('CDP debugging port'),
    host: z.string().default('127.0.0.1').describe('CDP host address'),
    target: z.string().optional().describe('Target page ID or URL fragment to connect to (e.g. "localhost:5173"). If omitted, connects to the first available page.'),
  },
  async ({ port, host, target }) => {
    try {
      if (connection) {
        await connection.close();
        workerManager?.clear();
      }

      connection = await createConnection({ port, host, target });
      workerManager = new WorkerManager(connection.client);
      await workerManager.start();

      const targets = await listCDPTargets({ port, host });
      const pages = targets.filter(t => t.type === 'page');
      const workers = workerManager.getWorkers();

      // Detect if connected to a blank/newtab page (common when another DevTools client manages the tab)
      const connectedPage = pages.find(p => p.id === targets[0]?.id) ?? pages[0];
      const connectedUrl = connectedPage?.url ?? '';
      const isBlankPage = !connectedUrl || connectedUrl === 'about:blank' || connectedUrl.startsWith('chrome://');

      const lines: string[] = [
        `Connected to Chrome at ${host}:${port}`,
        '',
        `Page targets (${pages.length}):`,
        ...pages.map(p => `  - [${p.id}] ${p.title} (${p.url})`),
        '',
        `Discovered workers (${workers.length}):`,
        ...workers.map(w => `  - [${w.type}] ${w.url} (session: ${w.sessionId.slice(0, 8)}...)`),
      ];

      if (isBlankPage && !target) {
        lines.push('');
        lines.push('WARNING: Connected to a blank or chrome:// page. The profiler may not reach your app.');
        lines.push('Ensure your app is loaded in Chrome, then reconnect with: connect({ target: "localhost:YOUR_PORT" })');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to connect: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: disconnect
// ---------------------------------------------------------------------------

server.tool(
  'disconnect',
  'Disconnect from the current Chrome instance and clean up all state.',
  async () => {
    try {
      if (activeSession) {
        try { await activeSession.stop(); } catch { /* best-effort */ }
        activeSession = null;
      }
      if (workerManager) {
        workerManager.clear();
        workerManager = null;
      }
      if (connection) {
        await connection.close();
        connection = null;
      }
      return { content: [{ type: 'text' as const, text: 'Disconnected.' }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Error during disconnect: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: list_targets
// ---------------------------------------------------------------------------

server.tool(
  'list_targets',
  'List available page targets and discovered workers in the connected Chrome instance.',
  async () => {
    try {
      if (!connection || !workerManager) {
        return { content: [{ type: 'text' as const, text: 'Not connected. Use "connect" first.' }], isError: true };
      }

      const targets = await listCDPTargets({ port: connection.port, host: connection.host });
      const pages = targets.filter(t => t.type === 'page');
      const workers = workerManager.getWorkers();

      const lines: string[] = [
        `Page targets (${pages.length}):`,
        ...pages.map(p => `  - [${p.id}] ${p.title} (${p.url})`),
        '',
        `Workers (${workers.length}):`,
        ...workers.map(w => `  - [${w.type}] ${w.url} (session: ${w.sessionId.slice(0, 8)}...)`),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to list targets: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: profile_scenario
// ---------------------------------------------------------------------------

server.tool(
  'profile_scenario',
  'Profile a single scenario: captures one CPU profile between a startMark and endMark.',
  {
    startMark: z.string().describe('performance.mark() name that signals the start of the scenario'),
    endMark: z.string().describe('performance.mark() name that signals the end of the scenario'),
    target: z.enum(['main', 'worker']).default('main').describe('Profile main thread or a worker'),
    workerUrl: z.string().optional().describe('URL fragment to identify the target worker'),
    samplingInterval: z.number().default(200).describe('CPU profiler sampling interval in microseconds'),
    output: z.string().default('./profiles/profile.cpuprofile').describe('Output file path'),
    timeoutMs: z.number().default(30000).describe('Timeout in milliseconds to wait for a capture'),
  },
  async ({ startMark, endMark, target, workerUrl, samplingInterval, output, timeoutMs }) => {
    try {
      if (!connection || !workerManager) {
        return { content: [{ type: 'text' as const, text: 'Not connected. Use "connect" first.' }], isError: true };
      }

      const session = new ProfilingSession({
        client: connection.client,
        workerManager,
        startMark,
        endMark,
        target,
        workerUrl,
        samplingInterval,
        maxCaptures: 1,
        outputDir: output.replace(/\/[^/]+$/, '') || './profiles',
      });

      const sessionId = await session.start();

      // Wait for one capture or timeout via polling
      const captured = await new Promise<boolean>((resolve) => {
        const pollInterval = setInterval(() => {
          const state = session.getState();
          if (state.captures.length >= 1) {
            clearInterval(pollInterval);
            resolve(true);
          }
        }, 100);

        session.setOnTimeout(() => {
          clearInterval(pollInterval);
          resolve(false);
        });

        // Also set our own timeout in case setOnTimeout doesn't fire
        setTimeout(() => {
          clearInterval(pollInterval);
          resolve(false);
        }, timeoutMs);
      });

      await session.stop();

      if (!captured) {
        return {
          content: [{ type: 'text' as const, text: `Timeout after ${timeoutMs}ms. No capture was recorded. Ensure the page triggers performance.mark('${startMark}') followed by performance.mark('${endMark}').` }],
          isError: true,
        };
      }

      const state = session.getState();
      const capture = state.captures[0];
      const top = capture.profile ? topFunctions(capture.profile, 10) : [];

      const lines: string[] = [
        `Captured profile (session ${sessionId})`,
        `  Duration: ${capture.duration.toFixed(1)}ms`,
        `  Label: ${capture.label}`,
        `  Overlapping invocations: ${capture.overlappingInvocations}`,
        `  Saved to: ${capture.files.cpu ?? 'N/A'}`,
        '',
        'Top functions by hit count:',
        ...top.map((f, i) => `  ${i + 1}. ${f.functionName} (${f.hitCount} hits) - ${f.url}:${f.lineNumber}`),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `profile_scenario failed: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: start_profiling_session
// ---------------------------------------------------------------------------

server.tool(
  'start_profiling_session',
  'Start a multi-capture profiling session. Captures continue until stop_profiling_session is called or limits are reached.',
  {
    startMark: z.string().describe('performance.mark() name that signals the start of each capture'),
    endMark: z.string().describe('performance.mark() name that signals the end of each capture'),
    target: z.enum(['main', 'worker', 'full']).default('main').describe('Profile main thread, a worker, or all threads (full trace)'),
    workerUrl: z.string().optional().describe('URL fragment to identify the target worker (not needed for full mode)'),
    samplingInterval: z.number().default(200).describe('CPU profiler sampling interval in microseconds (not used in full mode)'),
    outputDir: z.string().default('./profiles/session').describe('Directory for output files'),
    maxCaptures: z.number().default(50).describe('Maximum number of captures'),
    sessionTimeoutMs: z.number().default(300000).describe('Session timeout in milliseconds'),
  },
  async ({ startMark, endMark, target, workerUrl, samplingInterval, outputDir, maxCaptures, sessionTimeoutMs }) => {
    try {
      if (!connection || !workerManager) {
        return { content: [{ type: 'text' as const, text: 'Not connected. Use "connect" first.' }], isError: true };
      }

      if (activeSession) {
        return { content: [{ type: 'text' as const, text: 'A session is already active. Stop it first with stop_profiling_session.' }], isError: true };
      }

      activeSession = new ProfilingSession({
        client: connection.client,
        workerManager,
        startMark,
        endMark,
        target,
        workerUrl,
        samplingInterval,
        maxCaptures,
        outputDir,
        sessionTimeoutMs,
      });

      activeSession.setOnTimeout(async () => {
        if (activeSession) {
          try { await activeSession.stop(); } catch { /* best-effort */ }
          activeSession = null;
        }
      });

      const sessionId = await activeSession.start();

      const targetDesc = target === 'full'
        ? 'full (all threads via tracing)'
        : `${target}${workerUrl ? ` (worker: ${workerUrl})` : ''}`;

      const lines = [
        `Profiling session started: ${sessionId}`,
        `  Marks: ${startMark} -> ${endMark}`,
        `  Target: ${targetDesc}`,
        `  Max captures: ${maxCaptures}`,
        `  Timeout: ${sessionTimeoutMs}ms`,
        `  Output: ${outputDir}`,
        '',
        'Trigger the scenario in Chrome. Each start/end mark pair will be captured.',
        ...(target === 'full' ? ['Each capture saves a .trace.json (all threads) + extracted .cpuprofile files.'] : []),
        'Call stop_profiling_session when done.',
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      activeSession = null;
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `start_profiling_session failed: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: stop_profiling_session
// ---------------------------------------------------------------------------

server.tool(
  'stop_profiling_session',
  'Stop the active profiling session and return a summary with stats and outliers.',
  async () => {
    try {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session. Start one with start_profiling_session.' }], isError: true };
      }

      const summary = await activeSession.stop();
      activeSession = null;

      const lines: string[] = [
        `Session ${summary.sessionId} stopped.`,
        `  Marks: ${summary.startMark} -> ${summary.endMark}`,
        `  Total captures: ${summary.totalCaptures}`,
        '',
      ];

      if (summary.totalCaptures > 0) {
        // Captures table
        lines.push('Captures:');
        lines.push('  #   | Label                          | Duration (ms) | Overlaps');
        lines.push('  --- | ------------------------------ | ------------- | --------');
        for (const c of summary.captures) {
          const label = c.label.padEnd(30).slice(0, 30);
          lines.push(`  ${String(c.index).padStart(3)} | ${label} | ${c.duration.toFixed(1).padStart(13)} | ${c.overlappingInvocations}`);
        }
        lines.push('');

        // Stats
        const s = summary.stats.cpu;
        lines.push('Duration stats (ms):');
        lines.push(`  min=${s.min.toFixed(1)}  max=${s.max.toFixed(1)}  avg=${s.avg.toFixed(1)}  p50=${s.p50.toFixed(1)}  p95=${s.p95.toFixed(1)}  stddev=${s.stddev.toFixed(1)}`);
        lines.push('');

        // Outliers
        if (summary.outliers.length > 0) {
          lines.push(`Outliers (${summary.outliers.length}):`)
          for (const o of summary.outliers) {
            lines.push(`  - ${o.label}: ${o.value.toFixed(1)}ms (z-score: ${o.zscore.toFixed(2)}, metric: ${o.metric})`);
          }
        } else {
          lines.push('No outliers detected.');
        }

        // Mention trace files if present
        const hasTraceFiles = summary.captures.some(c => c.files.trace);
        if (hasTraceFiles) {
          lines.push('');
          lines.push('Trace files (.trace.json) are openable in chrome://tracing or DevTools Performance panel.');
          lines.push('Extracted .cpuprofile files can be used with compare_profiles.');
        }
      } else {
        lines.push('No captures were recorded during this session.');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      activeSession = null;
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `stop_profiling_session failed: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: compare_profiles
// ---------------------------------------------------------------------------

server.tool(
  'compare_profiles',
  'Compare two CPU profiles and show the functions with the largest hit-count differences.',
  {
    profileA: z.string().describe('File path to the first .cpuprofile'),
    profileB: z.string().describe('File path to the second .cpuprofile'),
    topN: z.number().default(20).describe('Number of top differing functions to show'),
  },
  async ({ profileA, profileB, topN }) => {
    try {
      const [profA, profB] = await Promise.all([
        loadProfile(profileA),
        loadProfile(profileB),
      ]);

      const diffs = compareProfiles(profA, profB, topN);

      const lines: string[] = [
        `Profile comparison (top ${topN} diffs):`,
        `  A: ${profileA} (${profileDurationMs(profA).toFixed(1)}ms)`,
        `  B: ${profileB} (${profileDurationMs(profB).toFixed(1)}ms)`,
        '',
        '  Function                       | Hits A | Hits B | Delta  | %A     | %B',
        '  ------------------------------ | ------ | ------ | ------ | ------ | ------',
      ];

      for (const d of diffs) {
        const name = d.functionName.padEnd(30).slice(0, 30);
        const hA = String(d.hitsA).padStart(6);
        const hB = String(d.hitsB).padStart(6);
        const delta = (d.delta >= 0 ? '+' : '') + String(d.delta);
        const pA = d.percentA.toFixed(1).padStart(5) + '%';
        const pB = d.percentB.toFixed(1).padStart(5) + '%';
        lines.push(`  ${name} | ${hA} | ${hB} | ${delta.padStart(6)} | ${pA} | ${pB}`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `compare_profiles failed: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
