import { Parser } from "htmlparser2";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";

// ---------------------------------------------------------------------------
// 1. Build a realistic, complex HTML string (~5000 chars total, ~3000 text)
// ---------------------------------------------------------------------------
function buildComplexHtml() {
  // Prose blocks that sum to ~3000 characters of visible text
  const paragraphs = [
    `The quick brown fox jumps over the lazy dog. `,
    `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. `,
    `Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `,
    `Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. `,
    `Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. Donec lobortis risus a elit. Etiam tempor. `,
  ];

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complex Document</title>
  <style>
    .container { max-width: 800px; margin: 0 auto; }
    .highlight { background: #ff0; font-weight: bold; }
    .card { border: 1px solid #ccc; padding: 16px; margin: 8px 0; }
    @media (max-width: 768px) { .container { padding: 0 12px; } }
  </style>
</head>
<body>
  <div class="container" id="main-content" data-page="article" data-version="3.2.1">
    <header>
      <nav aria-label="Main navigation">
        <ul>
          <li><a href="/home" class="nav-link active">Home</a></li>
          <li><a href="/about" class="nav-link">About</a></li>
          <li><a href="/contact" class="nav-link">Contact</a></li>
        </ul>
      </nav>
      <h1 class="title">${paragraphs[0]}</h1>
    </header>
    <main>
      <article class="card" data-id="1">
        <h2>Section One</h2>
        <p class="highlight">${paragraphs[1]}</p>
        <p>${paragraphs[2]}</p>
        <div class="metadata">
          <span class="author">Author: <strong>Jane Doe</strong></span>
          <time datetime="2025-01-15">January 15, 2025</time>
        </div>
      </article>
      <article class="card" data-id="2">
        <h2>Section Two</h2>
        <p>${paragraphs[3]}</p>
        <ul>
          <li>First item in the nested list structure with some extra text</li>
          <li>Second item with <em>emphasized</em> and <strong>bold</strong> text</li>
          <li>Third item containing a <a href="https://example.com/page?q=search&amp;lang=en">hyperlink</a></li>
        </ul>
        <blockquote cite="https://example.com/quote">
          <p>${paragraphs[4]}</p>
        </blockquote>
      </article>
      <section class="card" data-id="3">
        <h2>Data Table</h2>
        <table>
          <thead><tr><th>Name</th><th>Value</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>Alpha</td><td>100</td><td>The first measurement result from the experiment</td></tr>
            <tr><td>Beta</td><td>200</td><td>The second measurement result from the experiment</td></tr>
            <tr><td>Gamma</td><td>300</td><td>The third measurement result from the experiment</td></tr>
            <tr><td>Delta</td><td>400</td><td>The fourth measurement result from the experiment</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card" data-id="4">
        <h2>Form Section</h2>
        <form action="/submit" method="post">
          <div class="form-group">
            <label for="name">Full Name</label>
            <input type="text" id="name" name="name" placeholder="Enter your name" required>
          </div>
          <div class="form-group">
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" placeholder="Enter your email">
          </div>
          <div class="form-group">
            <label for="message">Your Message</label>
            <textarea id="message" name="message" rows="4" cols="50">Please enter your detailed feedback here so we can improve our services and provide better support to all users.</textarea>
          </div>
          <button type="submit" class="btn btn-primary">Submit Form</button>
        </form>
      </section>
      <aside>
        <h3>Related Articles</h3>
        <ul>
          <li><a href="/article/1">Understanding performance optimization in modern web applications</a></li>
          <li><a href="/article/2">Advanced HTML parsing techniques for content extraction</a></li>
          <li><a href="/article/3">Benchmarking JavaScript string operations at scale</a></li>
        </ul>
      </aside>
    </main>
    <footer>
      <p>&copy; 2025 Example Corp. All rights reserved. Terms of Service and Privacy Policy apply.</p>
      <div class="social">
        <a href="https://twitter.com/example" aria-label="Twitter"><img src="/icons/twitter.svg" alt="Twitter"></a>
        <a href="https://github.com/example" aria-label="GitHub"><img src="/icons/github.svg" alt="GitHub"></a>
      </div>
    </footer>
  </div>
  <!-- analytics snippet -->
  <script>
    (function() { var s = document.createElement('script'); s.async = true; s.src = '/analytics.js'; document.head.appendChild(s); })();
  </script>
</body>
</html>`;
  return html;
}

// ---------------------------------------------------------------------------
// 2. Approach A – htmlparser2
// ---------------------------------------------------------------------------
function textLengthExceedsWithParser(html, threshold) {
  let length = 0;
  let exceeded = false;
  const parser = new Parser({
    ontext(text) {
      if (exceeded) return;
      length += text.length;
      if (length > threshold) {
        exceeded = true;
      }
    },
  });
  parser.write(html);
  parser.end();
  return exceeded;
}

// ---------------------------------------------------------------------------
// 3. Approach B – Regex strip tags then measure
// ---------------------------------------------------------------------------
function textLengthExceedsWithRegex(html, threshold) {
  // Remove <script> and <style> blocks first, then strip remaining tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return stripped.length > threshold;
}

// ---------------------------------------------------------------------------
// 4. Approach C – Regex with early exit (char-by-char after strip)
// ---------------------------------------------------------------------------
function textLengthExceedsWithRegexEarlyExit(html, threshold) {
  // Same strip, but we could short-circuit if the full string is under threshold
  const noScriptStyle = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  let length = 0;
  let inTag = false;
  for (let i = 0; i < noScriptStyle.length; i++) {
    const ch = noScriptStyle[i];
    if (ch === "<") {
      inTag = true;
    } else if (ch === ">") {
      inTag = false;
    } else if (!inTag) {
      length++;
      if (length > threshold) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Approach D – jsdom (DOM parsing without browser)
// ---------------------------------------------------------------------------
function textLengthExceedsWithJsdom(html, threshold) {
  const dom = new JSDOM(html);
  const text = dom.window.document.body.textContent || "";
  return text.length > threshold;
}

// ---------------------------------------------------------------------------
// 6. Approach E – linkedom (lightweight DOM parsing without browser)
// ---------------------------------------------------------------------------
function textLengthExceedsWithLinkedom(html, threshold) {
  const { document } = parseHTML(html);
  const text = document.body.textContent || "";
  return text.length > threshold;
}

// ---------------------------------------------------------------------------
// 7. Benchmark harness
// ---------------------------------------------------------------------------
function bench(label, fn, iterations) {
  // Warmup
  for (let i = 0; i < 1000; i++) fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const mean = sum / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const min = times[0];
  const max = times[times.length - 1];

  return { label, mean, median, p95, p99, min, max, iterations };
}

function formatUs(ms) {
  return (ms * 1000).toFixed(2) + " µs";
}

// ---------------------------------------------------------------------------
// 6. Run
// ---------------------------------------------------------------------------
const html = buildComplexHtml();
const THRESHOLD = 2000;
const ITERATIONS = 10_000;

// Verify correctness
const resultParser = textLengthExceedsWithParser(html, THRESHOLD);
const resultRegex = textLengthExceedsWithRegex(html, THRESHOLD);
const resultRegexEarly = textLengthExceedsWithRegexEarlyExit(html, THRESHOLD);
const resultJsdom = textLengthExceedsWithJsdom(html, THRESHOLD);
const resultLinkedom = textLengthExceedsWithLinkedom(html, THRESHOLD);

console.log("=== HTML Text Length Benchmark ===\n");
console.log(`HTML string length : ${html.length} characters`);

// Measure actual text content length for reference
let actualTextLen = 0;
const p = new Parser({ ontext(t) { actualTextLen += t.length; } });
p.write(html); p.end();
console.log(`Actual text length : ${actualTextLen} characters (via htmlparser2)`);
console.log(`Threshold          : ${THRESHOLD} characters`);
console.log(`Exceeds threshold? : parser=${resultParser}, regex=${resultRegex}, regexEarly=${resultRegexEarly}, jsdom=${resultJsdom}, linkedom=${resultLinkedom}`);
console.log(`Iterations         : ${ITERATIONS.toLocaleString()}\n`);

const allAgree = [resultParser, resultRegex, resultRegexEarly, resultJsdom, resultLinkedom].every(r => r === resultParser);
if (!allAgree) {
  console.error("ERROR: Results disagree between methods!");
  process.exit(1);
}

// Use fewer iterations for DOM parsers since they are much slower
const DOM_ITERATIONS = 1_000;

const r1 = bench("htmlparser2", () => textLengthExceedsWithParser(html, THRESHOLD), ITERATIONS);
const r2 = bench("regex (strip all)", () => textLengthExceedsWithRegex(html, THRESHOLD), ITERATIONS);
const r3 = bench("regex (early exit)", () => textLengthExceedsWithRegexEarlyExit(html, THRESHOLD), ITERATIONS);
const r4 = bench("jsdom", () => textLengthExceedsWithJsdom(html, THRESHOLD), DOM_ITERATIONS);
const r5 = bench("linkedom", () => textLengthExceedsWithLinkedom(html, THRESHOLD), DOM_ITERATIONS);

console.log("--- Results (per call) ---\n");
console.log(
  `${"Method".padEnd(22)} ${"Iterations".padStart(10)} ${"Mean".padStart(12)} ${"Median".padStart(12)} ${"P95".padStart(12)} ${"P99".padStart(12)} ${"Min".padStart(12)} ${"Max".padStart(12)}`
);
console.log("-".repeat(106));
for (const r of [r1, r2, r3, r4, r5]) {
  console.log(
    `${r.label.padEnd(22)} ${String(r.iterations).padStart(10)} ${formatUs(r.mean).padStart(12)} ${formatUs(r.median).padStart(12)} ${formatUs(r.p95).padStart(12)} ${formatUs(r.p99).padStart(12)} ${formatUs(r.min).padStart(12)} ${formatUs(r.max).padStart(12)}`
  );
}

const fastest = r2; // regex is fastest baseline
console.log(`\n--- Relative to regex (strip all) ---\n`);
for (const r of [r1, r2, r3, r4, r5]) {
  const ratio = r.mean / fastest.mean;
  const label = ratio > 1 ? `${ratio.toFixed(1)}x slower` : ratio < 1 ? `${(1/ratio).toFixed(1)}x faster` : "baseline";
  console.log(`  ${r.label.padEnd(22)} ${ratio === 1 ? "1.0x (baseline)" : label}`);
}
