import { Parser } from "htmlparser2";

// ---------------------------------------------------------------------------
// The two approaches under test
// ---------------------------------------------------------------------------
function hp2_textLength(html) {
  let len = 0;
  let skip = false;
  const parser = new Parser({
    onopentag(name) { if (name === "script" || name === "style") skip = true; },
    onclosetag(name) { if (name === "script" || name === "style") skip = false; },
    ontext(t) { if (!skip) len += t.length; },
  });
  parser.write(html);
  parser.end();
  return len;
}

function regex_textLength(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .length;
}

// ---------------------------------------------------------------------------
// Edge case test runner
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;

function test(name, html, description) {
  const hp2 = hp2_textLength(html);
  const reg = regex_textLength(html);
  const match = hp2 === reg;

  if (!match) {
    failCount++;
    console.log(`MISMATCH  ${name}`);
    console.log(`          ${description}`);
    console.log(`          htmlparser2: ${hp2} chars`);
    console.log(`          regex:       ${reg} chars`);
    console.log(`          delta:       ${reg - hp2} (regex ${reg > hp2 ? "over" : "under"}-counts by ${Math.abs(reg - hp2)})`);
    console.log(`          html: ${html.length > 120 ? html.slice(0, 120) + "..." : html}`);
    console.log();
  } else {
    passCount++;
    console.log(`  OK      ${name}`);
  }
}

console.log("=== Regex vs htmlparser2: Edge Cases Where Regex Breaks ===\n");
console.log("Each test shows where regex /<[^>]+>/g gets a DIFFERENT text");
console.log("length than htmlparser2 (the correct answer).\n");

// =====================================================================
// CATEGORY 1: Attributes containing >
// =====================================================================
console.log("━━━ Category 1: Attributes containing > ━━━\n");

test(
  "1a. > inside attribute value",
  `<div data-expr="x > 5">visible</div>`,
  "A > inside a quoted attribute. Regex thinks the tag ends at the first >."
);

test(
  "1b. Multiple > in attributes",
  `<div data-a="1>2" data-b="3>4>5">text</div>`,
  "Multiple > chars in different attributes."
);

test(
  "1c. > in single-quoted attribute",
  `<div data-x='a > b'>content</div>`,
  "Single-quoted attribute with >."
);

test(
  "1d. Event handler with >",
  `<button onclick="if(x>3){alert('hi')}">Click</button>`,
  "Inline JS in onclick with > operator."
);

test(
  "1e. SVG path with > in attribute",
  `<svg><path d="M0,0 L10>5 Z"/></svg>visible`,
  "SVG path data containing >."
);

// =====================================================================
// CATEGORY 2: Script/style content edge cases
// =====================================================================
console.log("\n━━━ Category 2: Script/style content ━━━\n");

test(
  "2a. Script with </script> in string literal",
  `<script>var x = "</"+"script>"; var y = 42;</script>after`,
  "Script containing a broken-up </script> string. Both handle this."
);

test(
  "2b. Script with closing tag in comment",
  `<script>// this has no </script> issue\nvar a = 1;</script>visible`,
  "JS comment containing </script>. Regex matches first </script> greedily."
);

test(
  "2c. Two script blocks",
  `<script>a();</script>between<script>b();</script>after`,
  "Two scripts with text between them."
);

test(
  "2d. Script with HTML-like content",
  `<script>document.write("<p>hello</p>");</script>visible`,
  "Script writing HTML that looks like tags."
);

test(
  "2e. Style with > in selector",
  `<style>div > p { color: red; }</style>visible`,
  "CSS child combinator > inside style tag."
);

test(
  "2f. Style with content property containing tags",
  `<style>.x::before { content: "<div>fake</div>"; }</style>visible`,
  "CSS content property with HTML-like string."
);

test(
  "2g. CDATA in script (XHTML)",
  `<script>//<![CDATA[\nvar x = 1;\n//]]></script>after`,
  "XHTML-style CDATA in script block."
);

// =====================================================================
// CATEGORY 3: HTML comments
// =====================================================================
console.log("\n━━━ Category 3: Comments ━━━\n");

test(
  "3a. Comment with > inside",
  `<!-- this > that -->visible`,
  "Comment containing a > character. Regex [^>]+ stops at the first >."
);

test(
  "3b. Comment with tag-like content",
  `<!-- <div>not real</div> -->visible`,
  "Comment containing what looks like HTML tags."
);

test(
  "3c. Comment with -- inside",
  `<!-- invalid -- comment -->visible`,
  "Comment with -- in the middle (technically invalid but common)."
);

test(
  "3d. Conditional comment (IE)",
  `<!--[if IE]><p>IE only</p><![endif]-->after`,
  "IE conditional comment wrapping real HTML."
);

test(
  "3e. Empty comment",
  `<!---->visible`,
  "Minimal comment."
);

test(
  "3f. Comment with multiple >",
  `<!-- a > b > c > d -->text`,
  "Multiple > inside a comment."
);

// =====================================================================
// CATEGORY 4: Malformed / unusual HTML
// =====================================================================
console.log("\n━━━ Category 4: Malformed / unusual HTML ━━━\n");

test(
  "4a. Unclosed tag",
  `<div<span>text</span>`,
  "Missing > on first tag. htmlparser2 handles error recovery differently."
);

test(
  "4b. Bare < in text",
  `text with < less than sign and more`,
  "A bare < that's not part of a tag. Regex tries to match it as tag start."
);

test(
  "4c. Bare > in text",
  `text with > greater than sign`,
  "A bare > in text content."
);

test(
  "4d. Multiple bare < signs",
  `1 < 2 and 3 < 4 but 5 > 3`,
  "Math-like content with bare angle brackets."
);

test(
  "4e. Angle brackets in pre/code",
  `<pre>if (x < 10 && y > 5) { return true; }</pre>`,
  "Code content with unescaped angle brackets."
);

test(
  "4f. Tag-like but not a tag",
  `< div>not a tag</ div>also not`,
  "Space after < means it's not a tag per spec."
);

test(
  "4g. Empty attribute with >",
  `<input value="">after`,
  "Empty attribute value (valid HTML, but tests the regex)."
);

// =====================================================================
// CATEGORY 5: HTML entities
// =====================================================================
console.log("\n━━━ Category 5: HTML entities ━━━\n");

test(
  "5a. &gt; entity",
  `<p>5 &gt; 3</p>`,
  "&gt; is a single visible character (>). Both should count it but differently."
);

test(
  "5b. &lt; entity",
  `<p>3 &lt; 5</p>`,
  "&lt; entity. Regex counts the raw entity chars; htmlparser2 decodes."
);

test(
  "5c. &amp; entity",
  `<p>this &amp; that</p>`,
  "&amp; is 5 chars raw but represents 1 char."
);

test(
  "5d. Numeric entity",
  `<p>&#60;not a tag&#62;</p>`,
  "Numeric entities for < and >."
);

test(
  "5e. Named entity mix",
  `<p>&lt;div&gt;fake&lt;/div&gt;</p>`,
  "Entities forming what looks like a tag. Neither should treat it as HTML."
);

test(
  "5f. Non-breaking space",
  `<p>word&nbsp;word</p>`,
  "&nbsp; is 6 raw chars but 1 decoded char."
);

test(
  "5g. Unicode entity",
  `<p>&#x1F600; smile</p>`,
  "Hex unicode entity for emoji."
);

// =====================================================================
// CATEGORY 6: Nesting edge cases
// =====================================================================
console.log("\n━━━ Category 6: Nesting / structure ━━━\n");

test(
  "6a. Nested quotes in attributes",
  `<div title="he said 'hello > world'">text</div>`,
  "Nested quotes with > inside the attribute."
);

test(
  "6b. Unquoted attribute with >",
  `<div title=a>b>text</div>`,
  "Unquoted attribute value — > ends the tag per spec."
);

test(
  "6c. Template literal in attribute",
  `<div data-tpl="<span>{{name}}</span>">visible</div>`,
  "Template markup stored in an attribute."
);

test(
  "6d. Textarea with HTML-like content",
  `<textarea><p>not a real tag</p></textarea>after`,
  "Textarea treats content as text, not HTML."
);

test(
  "6e. XMP tag (deprecated)",
  `<xmp><b>this is literal text, not bold</b></xmp>after`,
  "XMP tag renders content literally."
);

test(
  "6f. Deeply nested structure",
  `<div><div><div><span><em><strong>deep</strong></em></span></div></div></div>`,
  "Many levels of nesting (correctness check)."
);

// =====================================================================
// CATEGORY 7: DOCTYPE / processing instructions / CDATA
// =====================================================================
console.log("\n━━━ Category 7: DOCTYPE / PI / CDATA ━━━\n");

test(
  "7a. DOCTYPE with attributes",
  `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><p>text</p>`,
  "Full DOCTYPE declaration."
);

test(
  "7b. XML processing instruction",
  `<?xml version="1.0" encoding="UTF-8"?><p>text</p>`,
  "XML PI — the ? before > can confuse some regex."
);

test(
  "7c. CDATA section",
  `<![CDATA[this is <raw> content with > signs]]>after`,
  "CDATA sections contain raw text that should not be parsed as HTML."
);

// =====================================================================
// CATEGORY 8: Real-world adversarial cases
// =====================================================================
console.log("\n━━━ Category 8: Real-world adversarial ━━━\n");

test(
  "8a. Email template with conditional comments",
  `<!--[if mso]><table><tr><td><![endif]--><div>content</div><!--[if mso]></td></tr></table><![endif]-->`,
  "Microsoft Outlook conditional comments in email HTML."
);

test(
  "8b. Angular/Vue template syntax",
  `<div *ngIf="count > 0" [class]="x > 5 ? 'big' : 'small'">{{value}}</div>`,
  "Angular template with > in bindings."
);

test(
  "8c. React JSX-like (as string)",
  `<div className="test" data-jsx="return x > 0 && <span>hi</span>">content</div>`,
  "JSX-like string with > in attribute."
);

test(
  "8d. Inline SVG with complex attributes",
  `<svg viewBox="0 0 100 100"><polygon points="50,5 90>40 75,85"/></svg>text`,
  "SVG with > in points attribute."
);

test(
  "8e. Data URI in attribute",
  `<img src="data:text/html,<h1>hello</h1>">after`,
  "Data URI containing HTML. The regex may try to parse the URI HTML."
);

test(
  "8f. JSON in script tag",
  `<script type="application/json">{"key": "val > other", "arr": [1,2,3]}</script>visible`,
  "JSON-LD or config script with > in values."
);

test(
  "8g. Multiline attribute",
  `<div
  data-config="x > 5
  && y < 10"
>content</div>`,
  "Attribute value spanning multiple lines with > inside."
);

test(
  "8h. Server-side template residue",
  `<div class="<%= highlighted ? 'active' : '' %>">text</div>`,
  "ERB/EJS template tags that weren't processed."
);

// =====================================================================
// Summary
// =====================================================================
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log(`TOTAL: ${passCount + failCount} tests`);
console.log(`  MATCH:    ${passCount} (regex agrees with htmlparser2)`);
console.log(`  MISMATCH: ${failCount} (regex gets wrong length)\n`);

if (failCount > 0) {
  console.log("CONCLUSION: Regex is fast but breaks on these patterns.");
  console.log("If your HTML can contain ANY of the MISMATCH cases above,");
  console.log("regex will silently give you the wrong text length.\n");
  console.log("The most common real-world failures:");
  console.log('  - > inside attributes:  <div data-x="a > b">');
  console.log("  - HTML comments:        <!-- a > b -->");
  console.log("  - Bare < in text:       3 < 5 (unescaped)");
  console.log("  - HTML entities:        &gt; &lt; &amp; (count differs)");
  console.log("  - Template syntax:      *ngIf=\"x > 0\"");
}
