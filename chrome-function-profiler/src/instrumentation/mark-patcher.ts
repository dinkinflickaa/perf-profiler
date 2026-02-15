/**
 * Generate JavaScript code that patches performance.mark to trigger
 * console.profile()/console.profileEnd() on matching mark names.
 * Injected into page/worker via Runtime.evaluate.
 * console.profile() starts V8 CPU profiler synchronously — zero IPC latency.
 */
export function generateMarkPatch(
  startMark: string,
  endMark: string,
  maxCaptures: number
): string {
  const escapedStart = startMark.replace(/'/g, "\\'");
  const escapedEnd = endMark.replace(/'/g, "\\'");

  return `(function() {
  var startMark = '${escapedStart}';
  var endMark = '${escapedEnd}';
  var maxCaptures = ${maxCaptures};
  var origMark = performance.mark.bind(performance);

  var captureIndex = 0;
  var depth = 0;
  var maxDepthThisCapture = 0;

  performance.__originalMark = origMark;

  performance.mark = function(name, options) {
    if (name.includes(startMark) && captureIndex < maxCaptures) {
      depth++;
      if (depth > maxDepthThisCapture) maxDepthThisCapture = depth;
      if (depth === 1) {
        captureIndex++;
        console.profile('capture-' + captureIndex);
      }
    }

    var result = origMark(name, options);

    if (name.includes(endMark) && depth > 0) {
      depth--;
      if (depth === 0) {
        var title = 'capture-' + captureIndex +
          (maxDepthThisCapture > 1 ? ':overlap-' + maxDepthThisCapture : '');
        maxDepthThisCapture = 0;
        console.profileEnd(title);
      }
    }

    return result;
  };
})();`;
}

/**
 * Generate JavaScript code that patches performance.mark to trigger
 * __cfp_signal binding calls for tracing mode (full capture).
 * Uses Runtime.addBinding on the server side to receive signals.
 */
export function generateTracingMarkPatch(
  startMark: string,
  endMark: string,
  maxCaptures: number
): string {
  const escapedStart = startMark.replace(/'/g, "\\'");
  const escapedEnd = endMark.replace(/'/g, "\\'");

  return `(function() {
  var startMark = '${escapedStart}';
  var endMark = '${escapedEnd}';
  var maxCaptures = ${maxCaptures};
  var origMark = performance.mark.bind(performance);

  var captureIndex = 0;
  var depth = 0;
  var maxDepthThisCapture = 0;

  performance.__originalMark = origMark;

  performance.mark = function(name, options) {
    if (name.includes(startMark) && captureIndex < maxCaptures) {
      depth++;
      if (depth > maxDepthThisCapture) maxDepthThisCapture = depth;
      if (depth === 1) {
        captureIndex++;
        try { __cfp_signal('start:' + captureIndex); } catch(e) {}
      }
    }

    var result = origMark(name, options);

    if (name.includes(endMark) && depth > 0) {
      depth--;
      if (depth === 0) {
        var overlap = maxDepthThisCapture;
        maxDepthThisCapture = 0;
        try { __cfp_signal('end:' + captureIndex + ':' + overlap); } catch(e) {}
      }
    }

    return result;
  };
})();`;
}

export function generateRestorePatch(): string {
  return `(function() {
  if (performance.__originalMark) {
    performance.mark = performance.__originalMark;
    delete performance.__originalMark;
  }
})();`;
}

export function parseCaptureTitle(title: string): { captureIndex: number; overlapCount: number } {
  const match = title.match(/^capture-(\d+)(?::overlap-(\d+))?$/);
  if (!match) return { captureIndex: 0, overlapCount: 1 };
  return {
    captureIndex: parseInt(match[1], 10),
    overlapCount: match[2] ? parseInt(match[2], 10) : 1,
  };
}

export function generateAutoLabelQuery(): string {
  return `(function() {
  var active = document.querySelector('[aria-selected="true"]')
    || document.querySelector('[aria-current="true"]')
    || document.querySelector('.active[role="treeitem"]')
    || document.querySelector('.selected');
  if (active) return active.textContent?.trim().slice(0, 50);
  return location.hash || location.pathname.split('/').pop() || 'invocation';
})()`;
}
