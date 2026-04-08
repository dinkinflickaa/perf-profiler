// CDP driver for the React 18 render-slicing test.
//
// For each scenario (sync, transition):
//   1. Reload page, wait for it to mount (initial commit completes)
//   2. Start a CPU profile via Profiler.start
//   3. Click the corresponding button
//   4. Poll until the page reports the result via window.__lastResult
//   5. Stop the CPU profile, save it to disk
//   6. Read the performance.measure entries for click-to-paint and intermediate marks
//
// We deliberately use the page's own performance.now() based measurements as
// the ground truth for click-to-paint, because they include the wall-clock
// rAF / paint wait that CDP can't observe directly.

import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = '/home/user/perf-profiler/profiles/react18-slicing';
fs.mkdirSync(OUT_DIR, { recursive: true });

const HOST = '127.0.0.1';
const PORT = 9222;
const APP_URL_DEFAULT = 'http://localhost:5174/';

async function findPageTarget() {
  const targets = await CDP.List({ host: HOST, port: PORT });
  const t = targets.find((x) => x.type === 'page' && x.url.includes('5174'));
  if (!t) throw new Error('Could not find target page');
  return t;
}

async function navigateTo(url) {
  const target = await findPageTarget();
  const client = await CDP({ host: HOST, port: PORT, target: target.id });
  await client.Page.enable();
  await client.Page.navigate({ url });
  await client.Page.loadEventFired();
  await client.close();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMounted(client) {
  // After createRoot().render, the initial commit takes ~10s for 500 children
  // (5s render + 5s layoutEffect). We poll for the button + a sentinel value.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await client.Runtime.evaluate({
      expression:
        '(() => { const b=document.getElementById("btn-sync"); ' +
        'return b ? "ready" : "missing"; })()',
      returnByValue: true,
    });
    if (r.result.value === 'ready') {
      // Wait for the initial paint after mount to settle
      await client.Runtime.evaluate({
        expression:
          'new Promise(res => requestAnimationFrame(() => setTimeout(res, 50)))',
        awaitPromise: true,
      });
      return;
    }
    await sleep(200);
  }
  throw new Error('Page did not mount in time');
}

async function runScenario(scenarioName, buttonId, urlSearch = '') {
  console.log(`\n=== Scenario: ${scenarioName} ===`);
  // Navigate first (so the URL params take effect for this run)
  await navigateTo(APP_URL_DEFAULT + urlSearch);

  const target = await findPageTarget();
  const client = await CDP({ host: HOST, port: PORT, target: target.id });

  await client.Runtime.enable();
  await client.Profiler.enable();
  await client.Page.enable();

  // Forward console messages so we can see [result] lines from the page
  client.Runtime.consoleAPICalled(({ type, args }) => {
    const text = args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (text.includes('[result]') || text.startsWith('[debug]')) {
      console.log(`  page> ${text}`);
    }
  });

  // (Already navigated above; just wait a tick for everything to settle)

  console.log('  waiting for initial mount (this takes ~10s for 500 children)...');
  await waitForMounted(client);

  // Clear any leftover marks from initial mount
  await client.Runtime.evaluate({
    expression: 'performance.clearMarks(); performance.clearMeasures(); window.__lastResult = "";',
  });

  // Start CPU profile with a fine sampling interval (250us)
  await client.Profiler.setSamplingInterval({ interval: 250 });
  await client.Profiler.start();

  // Inject a result-capture hook so we can poll for completion
  await client.Runtime.evaluate({
    expression: `(() => {
      window.__lastResult = "";
      const orig = console.log;
      console.log = function(...args) {
        if (args[0] === '[result]') { window.__lastResult = args[1]; }
        return orig.apply(this, args);
      };
    })()`,
  });

  console.log(`  clicking ${buttonId}...`);
  const t0 = Date.now();
  await client.Runtime.evaluate({
    expression: `document.getElementById('${buttonId}').click()`,
  });

  // Poll for completion (page's useLayoutEffect+rAF+setTimeout sets __lastResult)
  const deadline = Date.now() + 60_000;
  let lastResult = '';
  while (Date.now() < deadline) {
    const r = await client.Runtime.evaluate({
      expression: 'window.__lastResult || ""',
      returnByValue: true,
    });
    if (r.result.value && r.result.value.length > 0) {
      lastResult = r.result.value;
      break;
    }
    await sleep(50);
  }
  const wall = Date.now() - t0;
  console.log(`  scenario complete in ${wall}ms wall time`);
  console.log(`  page result: ${lastResult}`);

  // Wait a bit so any trailing passive effects are captured by the profile
  await client.Runtime.evaluate({
    expression:
      'new Promise(res => requestAnimationFrame(() => setTimeout(res, 100)))',
    awaitPromise: true,
  });

  // Stop CPU profile
  const { profile } = await client.Profiler.stop();
  const cpuPath = path.join(OUT_DIR, `${scenarioName}.cpuprofile`);
  fs.writeFileSync(cpuPath, JSON.stringify(profile));
  console.log(`  saved cpu profile -> ${cpuPath}`);

  // Read all performance entries
  const entriesRes = await client.Runtime.evaluate({
    expression: `JSON.stringify({
      marks: performance.getEntriesByType('mark').map(e => ({name:e.name, startTime:e.startTime})),
      measures: performance.getEntriesByType('measure').map(e => ({name:e.name, startTime:e.startTime, duration:e.duration})),
      lastResult: window.__lastResult || "",
    })`,
    returnByValue: true,
  });
  const data = JSON.parse(entriesRes.result.value);
  const entriesPath = path.join(OUT_DIR, `${scenarioName}.entries.json`);
  fs.writeFileSync(entriesPath, JSON.stringify(data, null, 2));
  console.log(`  saved performance entries -> ${entriesPath}`);

  await client.close();
  return { scenarioName, wall, data, cpuPath };
}

async function main() {
  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      await CDP.List({ host: HOST, port: PORT });
      break;
    } catch {
      await sleep(500);
    }
  }

  const results = [];
  // Primary scenarios (full costs as user requested)
  results.push(await runScenario('test1-sync', 'btn-sync'));
  results.push(await runScenario('test2-transition', 'btn-transition'));
  // Diagnostic: same scenarios but with passive effect cost = 0, to isolate
  // whether passive effects are blocking the first paint of the new state.
  results.push(await runScenario('test1-sync-no-passive', 'btn-sync', '?passive=0&passiveCleanup=0'));
  results.push(await runScenario('test2-transition-no-passive', 'btn-transition', '?passive=0&passiveCleanup=0'));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`\n${r.scenarioName}:`);
    console.log(`  wall clock: ${r.wall}ms`);
    console.log(`  marks (relative to navigationStart):`);
    for (const m of r.data.marks) {
      console.log(`    ${m.startTime.toFixed(1).padStart(10)}ms  ${m.name}`);
    }
    console.log(`  measures:`);
    for (const m of r.data.measures) {
      console.log(`    ${m.duration.toFixed(1).padStart(10)}ms  ${m.name}`);
    }
    console.log(`  page reported: ${r.data.lastResult}`);
  }

  // Side-by-side comparison table
  console.log('\n=== COMPARISON TABLE ===');
  function getMeasure(r, name) {
    const m = r.data.measures.find((x) => x.name === name);
    return m ? m.duration : null;
  }
  function getFrameCount(r) {
    const m = (r.data.lastResult || '').match(/framesDuringWork=(\d+)/);
    return m ? Number(m[1]) : null;
  }
  function row(label, r, prefix) {
    const commit = getMeasure(r, `${prefix}-click-to-commit`);
    const fp = getMeasure(r, `${prefix}-click-to-first-paint`);
    const all = getMeasure(r, `${prefix}-click-to-all-done`);
    const frames = getFrameCount(r);
    return [
      label,
      commit != null ? commit.toFixed(1) : '-',
      fp != null ? fp.toFixed(1) : '-',
      all != null ? all.toFixed(1) : '-',
      String(frames ?? '-'),
    ];
  }
  const tableRows = [
    row('sync (full costs)', results[0], 'sync'),
    row('transition (full costs)', results[1], 'transition'),
    row('sync (passive=0)', results[2], 'sync'),
    row('transition (passive=0)', results[3], 'transition'),
  ];
  const headers = ['scenario', 'click→commit', 'click→1st paint', 'click→all done', 'frames during work'];
  const widths = headers.map((h, i) => Math.max(h.length, ...tableRows.map((r) => r[i].length)));
  const sep = widths.map((w) => '-'.repeat(w)).join(' | ');
  console.log('  ' + headers.map((h, i) => h.padEnd(widths[i])).join(' | '));
  console.log('  ' + sep);
  for (const r of tableRows) {
    console.log('  ' + r.map((c, i) => c.padEnd(widths[i])).join(' | '));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nWrote ${path.join(OUT_DIR, 'summary.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
