import { Parser } from "htmlparser2";
import { parseHTML } from "linkedom";

// ---------------------------------------------------------------------------
// HTML generators at different sizes
// ---------------------------------------------------------------------------
function buildHtml(paragraphCount) {
  const block = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. `;

  let body = "";
  for (let i = 0; i < paragraphCount; i++) {
    body += `
      <article class="card" data-id="${i}">
        <h2>Section ${i + 1}</h2>
        <p class="highlight">${block}</p>
        <div class="metadata">
          <span class="author">Author: <strong>User ${i}</strong></span>
          <time datetime="2025-01-${String(i + 1).padStart(2, "0")}">Jan ${i + 1}</time>
        </div>
        <ul>
          <li>Item one with <em>emphasis</em> and <strong>bold</strong></li>
          <li>Item two with a <a href="https://example.com/p?q=${i}&amp;r=1">link</a></li>
        </ul>
      </article>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Doc</title>
  <style>.card { border: 1px solid #ccc; } .highlight { color: red; }</style>
</head>
<body>
  <div class="container" id="main" data-page="test">
    <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
    <main>${body}</main>
    <footer><p>&copy; 2025 Corp</p></footer>
  </div>
  <script>(function(){ console.log("analytics"); })();</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------
function htmlparser2_textLength(html) {
  let length = 0;
  const parser = new Parser({
    ontext(text) { length += text.length; },
  });
  parser.write(html);
  parser.end();
  return length;
}

function linkedom_textLength(html) {
  const { document } = parseHTML(html);
  return (document.body.textContent || "").length;
}

function htmlparser2_exceeds(html, threshold) {
  let length = 0;
  let exceeded = false;
  const parser = new Parser({
    ontext(text) {
      if (exceeded) return;
      length += text.length;
      if (length > threshold) exceeded = true;
    },
  });
  parser.write(html);
  parser.end();
  return exceeded;
}

function linkedom_exceeds(html, threshold) {
  const { document } = parseHTML(html);
  return (document.body.textContent || "").length > threshold;
}

function htmlparser2_extractText(html) {
  const chunks = [];
  const parser = new Parser({
    ontext(text) { chunks.push(text); },
  });
  parser.write(html);
  parser.end();
  return chunks.join("");
}

function linkedom_extractText(html) {
  const { document } = parseHTML(html);
  return document.body.textContent || "";
}

function htmlparser2_countElements(html) {
  let count = 0;
  const parser = new Parser({
    onopentag() { count++; },
  });
  parser.write(html);
  parser.end();
  return count;
}

function linkedom_countElements(html) {
  const { document } = parseHTML(html);
  return document.querySelectorAll("*").length;
}

function htmlparser2_findLinks(html) {
  const links = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "a" && attrs.href) links.push(attrs.href);
    },
  });
  parser.write(html);
  parser.end();
  return links;
}

function linkedom_findLinks(html) {
  const { document } = parseHTML(html);
  return [...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href"));
}

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------
function bench(label, fn, iterations) {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 500); i++) fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const min = times[0];
  const max = times[times.length - 1];

  return { label, mean, median, p95, min, max, iterations };
}

function fmtUs(ms) {
  if (ms >= 1) return (ms).toFixed(2) + " ms";
  return (ms * 1000).toFixed(1) + " µs";
}

function printRow(label, r) {
  console.log(
    `  ${label.padEnd(16)} ${fmtUs(r.mean).padStart(12)} ${fmtUs(r.median).padStart(12)} ${fmtUs(r.p95).padStart(12)} ${fmtUs(r.min).padStart(12)}`
  );
}

function printHeader() {
  console.log(
    `  ${"".padEnd(16)} ${"Mean".padStart(12)} ${"Median".padStart(12)} ${"P95".padStart(12)} ${"Min".padStart(12)}`
  );
  console.log("  " + "-".repeat(64));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log("=== linkedom vs htmlparser2: Head-to-Head ===\n");

// --- Test 1: Scaling with HTML size ---
console.log("━━━ Test 1: Text length check across HTML sizes ━━━\n");
const sizes = [
  { paragraphs: 1, label: "small" },
  { paragraphs: 5, label: "medium" },
  { paragraphs: 20, label: "large" },
  { paragraphs: 50, label: "x-large" },
];

for (const { paragraphs, label } of sizes) {
  const html = buildHtml(paragraphs);
  const textLen = htmlparser2_textLength(html);
  const iters = paragraphs >= 20 ? 1_000 : 5_000;

  console.log(`[${label}] ${html.length} chars HTML, ${textLen} chars text, ${iters} iterations`);
  printHeader();

  const rH = bench("htmlparser2", () => htmlparser2_exceeds(html, 2000), iters);
  const rL = bench("linkedom", () => linkedom_exceeds(html, 2000), iters);
  printRow("htmlparser2", rH);
  printRow("linkedom", rL);

  const ratio = rL.median / rH.median;
  console.log(`  → linkedom is ${ratio.toFixed(1)}x ${ratio > 1 ? "slower" : "faster"} than htmlparser2 (median)\n`);
}

// --- Test 2: Different operations ---
console.log("━━━ Test 2: Different operations (medium HTML, 5 paragraphs) ━━━\n");
const mediumHtml = buildHtml(5);
const ITERS = 5_000;

const operations = [
  {
    name: "text length check",
    hp2: () => htmlparser2_exceeds(mediumHtml, 2000),
    lom: () => linkedom_exceeds(mediumHtml, 2000),
  },
  {
    name: "full text extract",
    hp2: () => htmlparser2_extractText(mediumHtml),
    lom: () => linkedom_extractText(mediumHtml),
  },
  {
    name: "count elements",
    hp2: () => htmlparser2_countElements(mediumHtml),
    lom: () => linkedom_countElements(mediumHtml),
  },
  {
    name: "find all links",
    hp2: () => htmlparser2_findLinks(mediumHtml),
    lom: () => linkedom_findLinks(mediumHtml),
  },
];

for (const op of operations) {
  // Verify both produce equivalent results
  const hp2Result = op.hp2();
  const lomResult = op.lom();
  const match = JSON.stringify(hp2Result) === JSON.stringify(lomResult);

  console.log(`[${op.name}] results match: ${match}`);
  if (!match) {
    console.log(`  htmlparser2: ${JSON.stringify(hp2Result).slice(0, 100)}`);
    console.log(`  linkedom:    ${JSON.stringify(lomResult).slice(0, 100)}`);
  }
  printHeader();

  const rH = bench("htmlparser2", op.hp2, ITERS);
  const rL = bench("linkedom", op.lom, ITERS);
  printRow("htmlparser2", rH);
  printRow("linkedom", rL);

  const ratio = rL.median / rH.median;
  console.log(`  → linkedom is ${ratio.toFixed(1)}x ${ratio > 1 ? "slower" : "faster"} (median)\n`);
}

// --- Test 3: Memory allocation pressure ---
console.log("━━━ Test 3: Memory allocation (100 rapid calls, medium HTML) ━━━\n");

function measureMemory(label, fn, calls) {
  global.gc?.(); // optional, only works with --expose-gc
  const before = process.memoryUsage();
  for (let i = 0; i < calls; i++) fn();
  const after = process.memoryUsage();

  const heapDelta = after.heapUsed - before.heapUsed;
  const rssDelta = after.rss - before.rss;
  console.log(`  ${label.padEnd(16)} heapUsed delta: ${(heapDelta / 1024).toFixed(0).padStart(8)} KB   rss delta: ${(rssDelta / 1024).toFixed(0).padStart(8)} KB`);
}

measureMemory("htmlparser2", () => htmlparser2_extractText(mediumHtml), 100);
measureMemory("linkedom", () => linkedom_extractText(mediumHtml), 100);

// --- Summary ---
console.log("\n━━━ Summary ━━━\n");
console.log("htmlparser2: SAX-style streaming parser. Low memory, no DOM tree.");
console.log("             Best for: text extraction, threshold checks, single-pass tasks.");
console.log("             Tradeoff: no querySelector, no DOM traversal.\n");
console.log("linkedom:    Builds a lightweight DOM tree with querySelector support.");
console.log("             Best for: tasks needing CSS selectors, DOM traversal, element queries.");
console.log("             Tradeoff: ~7-10x slower, higher memory from full tree construction.\n");
