import { Parser } from "htmlparser2";
import { parse as nhpParse } from "node-html-parser";
import * as cheerio from "cheerio";
import striptags from "striptags";

// ---------------------------------------------------------------------------
// HTML test content
// ---------------------------------------------------------------------------
function buildHtml(paragraphCount) {
  const block = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit. `;

  let body = "";
  for (let i = 0; i < paragraphCount; i++) {
    body += `
      <article class="card" data-id="${i}">
        <h2>Section ${i + 1}</h2>
        <p class="highlight">${block}</p>
        <div class="meta"><span>Author: <strong>User ${i}</strong></span></div>
        <ul>
          <li>Item with <em>emphasis</em> and <strong>bold</strong></li>
          <li>Link: <a href="https://example.com/p?q=${i}&amp;r=1">click</a></li>
        </ul>
      </article>`;
  }

  return `<!DOCTYPE html>
<html><head><title>Test</title>
<style>.card { border: 1px solid #ccc; }</style>
</head><body>
<div class="container">
  <header><nav><a href="/">Home</a></nav></header>
  <main>${body}</main>
  <footer><p>&copy; 2025 Corp</p></footer>
</div>
<script>(function(){ console.log("hi"); })();</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Approach 1: htmlparser2 (SAX streaming)
// ---------------------------------------------------------------------------
function hp2_textLength(html) {
  let len = 0;
  const parser = new Parser({ ontext(t) { len += t.length; } });
  parser.write(html);
  parser.end();
  return len;
}

// ---------------------------------------------------------------------------
// Approach 2: htmlparser2 with script/style skipping (more correct)
// ---------------------------------------------------------------------------
function hp2_textLength_skipScriptStyle(html) {
  let len = 0;
  let skip = false;
  const parser = new Parser({
    onopentag(name) {
      if (name === "script" || name === "style") skip = true;
    },
    onclosetag(name) {
      if (name === "script" || name === "style") skip = false;
    },
    ontext(t) { if (!skip) len += t.length; },
  });
  parser.write(html);
  parser.end();
  return len;
}

// ---------------------------------------------------------------------------
// Approach 3: Regex strip-all
// ---------------------------------------------------------------------------
function regex_textLength(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .length;
}

// ---------------------------------------------------------------------------
// Approach 4: Manual state machine (no regex, no library)
// ---------------------------------------------------------------------------
function stateMachine_textLength(html) {
  let len = 0;
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html[i] === "<") {
      // Check for <script or <style
      if (i + 7 < n) {
        const tag7 = html.substring(i + 1, i + 7).toLowerCase();
        if (tag7 === "script" || tag7 === "style>".substring(0, 6)) {
          const isScript = tag7 === "script";
          const closeTag = isScript ? "</script>" : "</style>";
          // Skip past the opening tag
          const tagEnd = html.indexOf(">", i);
          if (tagEnd === -1) break;
          // Find closing tag
          const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
          if (closeIdx === -1) { i = tagEnd + 1; continue; }
          i = closeIdx + closeTag.length;
          continue;
        }
      }
      // Check for <!-- comment -->
      if (i + 3 < n && html[i+1] === "!" && html[i+2] === "-" && html[i+3] === "-") {
        const commentEnd = html.indexOf("-->", i + 4);
        i = commentEnd === -1 ? n : commentEnd + 3;
        continue;
      }
      // Regular tag — skip to >
      const close = html.indexOf(">", i + 1);
      i = close === -1 ? n : close + 1;
    } else {
      len++;
      i++;
    }
  }
  return len;
}

// ---------------------------------------------------------------------------
// Approach 5: Manual state machine with early exit
// ---------------------------------------------------------------------------
function stateMachine_exceeds(html, threshold) {
  let len = 0;
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html[i] === "<") {
      if (i + 7 < n) {
        const tag7 = html.substring(i + 1, i + 7).toLowerCase();
        if (tag7 === "script" || tag7 === "style>".substring(0, 6)) {
          const isScript = tag7 === "script";
          const closeTag = isScript ? "</script>" : "</style>";
          const tagEnd = html.indexOf(">", i);
          if (tagEnd === -1) break;
          const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
          if (closeIdx === -1) { i = tagEnd + 1; continue; }
          i = closeIdx + closeTag.length;
          continue;
        }
      }
      if (i + 3 < n && html[i+1] === "!" && html[i+2] === "-" && html[i+3] === "-") {
        const commentEnd = html.indexOf("-->", i + 4);
        i = commentEnd === -1 ? n : commentEnd + 3;
        continue;
      }
      const close = html.indexOf(">", i + 1);
      i = close === -1 ? n : close + 1;
    } else {
      len++;
      if (len > threshold) return true;
      i++;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Approach 6: node-html-parser (fast DOM-like parser)
// ---------------------------------------------------------------------------
function nhp_textLength(html) {
  const root = nhpParse(html);
  return root.textContent.length;
}

// ---------------------------------------------------------------------------
// Approach 7: cheerio
// ---------------------------------------------------------------------------
function cheerio_textLength(html) {
  const $ = cheerio.load(html);
  $("script, style").remove();
  return $("body").text().length;
}

// ---------------------------------------------------------------------------
// Approach 8: striptags library
// ---------------------------------------------------------------------------
function striptags_textLength(html) {
  return striptags(html).length;
}

// ---------------------------------------------------------------------------
// Approach 9: indexOf-based tag hopping (minimal overhead)
// ---------------------------------------------------------------------------
function indexOfHop_textLength(html) {
  // Pre-strip script/style with indexOf (no regex)
  let cleaned = html;
  for (const tag of ["script", "style"]) {
    let result = "";
    let pos = 0;
    while (true) {
      const openIdx = cleaned.toLowerCase().indexOf(`<${tag}`, pos);
      if (openIdx === -1) { result += cleaned.substring(pos); break; }
      result += cleaned.substring(pos, openIdx);
      const closeIdx = cleaned.toLowerCase().indexOf(`</${tag}>`, openIdx);
      if (closeIdx === -1) { break; }
      pos = closeIdx + tag.length + 3;
    }
    cleaned = result;
  }

  // Now count non-tag characters
  let len = 0;
  let inTag = false;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "<") inTag = true;
    else if (cleaned[i] === ">") inTag = false;
    else if (!inTag) len++;
  }
  return len;
}

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------
function bench(label, fn, iterations) {
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
  return { label, mean, median, p95, min, iterations };
}

function fmtUs(ms) {
  if (ms >= 1) return (ms).toFixed(2) + " ms";
  return (ms * 1000).toFixed(1) + " µs";
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log("=== What's Faster Than htmlparser2 For Text Length? ===\n");

const sizes = [
  { paragraphs: 1, label: "small", iters: 10_000 },
  { paragraphs: 5, label: "medium", iters: 10_000 },
  { paragraphs: 20, label: "large", iters: 3_000 },
];

const approaches = [
  { name: "state machine",       fn: (html) => stateMachine_textLength(html) },
  { name: "state machine+bail",  fn: (html) => stateMachine_exceeds(html, 2000) },
  { name: "regex strip",         fn: (html) => regex_textLength(html) },
  { name: "striptags lib",       fn: (html) => striptags_textLength(html) },
  { name: "indexOf hop",         fn: (html) => indexOfHop_textLength(html) },
  { name: "htmlparser2",         fn: (html) => hp2_textLength(html) },
  { name: "htmlparser2 (skip)",  fn: (html) => hp2_textLength_skipScriptStyle(html) },
  { name: "node-html-parser",    fn: (html) => nhp_textLength(html) },
  { name: "cheerio",             fn: (html) => cheerio_textLength(html) },
];

for (const { paragraphs, label, iters } of sizes) {
  const html = buildHtml(paragraphs);
  const refLen = hp2_textLength_skipScriptStyle(html);

  console.log(`\n━━━ ${label.toUpperCase()} (${html.length} chars HTML, ~${refLen} text chars, ${iters} iters) ━━━\n`);
  console.log(
    `  ${"Method".padEnd(24)} ${"Median".padStart(12)} ${"Mean".padStart(12)} ${"P95".padStart(12)} ${"vs hp2".padStart(10)}`
  );
  console.log("  " + "-".repeat(70));

  let hp2Median = 0;
  const results = [];

  for (const approach of approaches) {
    // Use fewer iters for slow parsers
    const isSlowParser = ["cheerio", "node-html-parser"].includes(approach.name);
    const actualIters = isSlowParser ? Math.min(iters, 2_000) : iters;

    const r = bench(approach.name, () => approach.fn(html), actualIters);
    if (approach.name === "htmlparser2") hp2Median = r.median;
    results.push(r);
  }

  for (const r of results) {
    const vs = hp2Median > 0 ? (r.median / hp2Median).toFixed(2) + "x" : "-";
    console.log(
      `  ${r.label.padEnd(24)} ${fmtUs(r.median).padStart(12)} ${fmtUs(r.mean).padStart(12)} ${fmtUs(r.p95).padStart(12)} ${vs.padStart(10)}`
    );
  }
}

console.log("\n\nNote: 'vs hp2' < 1.0x means faster than htmlparser2\n");
