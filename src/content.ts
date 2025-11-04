import { Readability } from "@mozilla/readability";
import type { Hit } from "./types";

console.log("[CS] Loaded on", location.href);

// ---------- Config ---------------------------------------------------

const MAX_HIGHLIGHTS = 50; // avoid DOM overload
const MARK_ATTR = "data-tc"; // attribute added to our marks
const MARK_ATTR_VAL = "risk";

// ---------- Style (installed once) ----------------------------------

let stylesInstalled = false;
function installStylesOnce() {
  if (stylesInstalled) return;
  stylesInstalled = true;

  const style = document.createElement("style");
  style.id = "tc-decoder-highlight-style";
  style.textContent = `
    mark[${MARK_ATTR}="${MARK_ATTR_VAL}"] {
      background: #fff3cd;
      color: inherit;
      padding: 0 2px;
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.04) inset;
    }
  `;
  document.documentElement.appendChild(style);
}

// ---------- Highlight helpers ---------------------------------------

/**
 * True if this node is inside one of our previously inserted <mark data-tc="risk"> wrappers.
 */
function isInsideOurMark(node: Node | null): boolean {
  let el: Node | null = node;
  while (el && el !== document) {
    if (
      el instanceof Element &&
      el.tagName === "MARK" &&
      el.getAttribute(MARK_ATTR) === MARK_ATTR_VAL
    ) {
      return true;
    }
    el = el.parentNode;
  }
  return false;
}

/**
 * Remove all our previous highlights by unwrapping <mark data-tc="risk"> elements.
 */
function clearHighlights(): number {
  const marks = document.querySelectorAll(
    `mark[${MARK_ATTR}="${MARK_ATTR_VAL}"]`
  );
  let removed = 0;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    // Replace the <mark> with its text content (unwrap)
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    removed++;
  });
  return removed;
}

/**
 * Iterate visible text nodes in document order.
 * Skips <script>, <style>, <noscript>, and nodes inside our <mark> wrappers.
 */
function* textNodes(): Generator<Text> {
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
          return NodeFilter.FILTER_REJECT;
        if (isInsideOurMark(parent)) return NodeFilter.FILTER_REJECT;
        // Ignore entirely whitespace-only nodes
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );
  let n: Node | null;
  while ((n = walker.nextNode())) {
    yield n as Text;
  }
}

/**
 * Find the first occurrence of `needle` (case-insensitive) across text nodes,
 * and wrap it with <mark data-tc="risk">…</mark>.
 *
 * Returns true if wrapped, false if not found.
 */
function findAndWrapOnce(needle: string): boolean {
  if (!needle) return false;
  const needleLower = needle.toLowerCase();

  for (const node of textNodes()) {
    const text = node.nodeValue || "";
    const idx = text.toLowerCase().indexOf(needleLower);
    if (idx === -1) continue;

    // Create a range for the match within this text node
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + needle.length);

    // Wrap with <mark>
    const mark = document.createElement("mark");
    mark.setAttribute(MARK_ATTR, MARK_ATTR_VAL);
    range.surroundContents(mark);

    return true;
  }
  return false;
}

/**
 * Apply highlights for a list of hits.
 * This uses the full sentence snippet to re-find instances in the page and wrap the first match.
 * (Simple and robust for MVP; exact offset mapping is a heavier alternative.)
 */
function applyHighlights(hits: Hit[]): number {
  if (!hits?.length) return 0;

  installStylesOnce();

  let applied = 0;
  for (const h of hits) {
    if (applied >= MAX_HIGHLIGHTS) break;
    // Highlight the full sentence containing the keyword, not just the keyword itself
    // Use the snippet which contains the full sentence extracted by makeSnippet()
    let textToHighlight = h.snippet.replace(/^…|…$/g, '').trim(); // Remove leading/trailing ellipsis

    // Try to highlight the full snippet first
    let ok = findAndWrapOnce(textToHighlight);

    // If full snippet doesn't match (whitespace differences, etc.),
    // fall back to highlighting just the keyword
    if (!ok && h.text) {
      console.log(`[CS] Full snippet not found, falling back to keyword: "${h.text}"`);
      ok = findAndWrapOnce(h.text);
    }

    if (ok) applied++;
  }
  console.log(`[CS] Applied ${applied} highlights out of ${hits.length} hits`);
  return applied;
}

// ---------- Message handler -----------------------------------------
chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
  // Requester: SW
  if (request.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (request.type === "EXTRACT_REQUEST") {
    console.log("[CS] EXTRACT_REQUEST received");
    try {
      // Extract
      const docClone = document.cloneNode(true) as Document;
      const reader = new Readability(docClone);
      const article = reader.parse();

      const extractedText = article?.textContent || document.body.innerText || "";
      const extractedTitle = article?.title || document.title || "";

      // Log the full extracted text
      console.log("[CS] ========== FULL EXTRACTED TEXT ==========");
      console.log(`[CS] Title: ${extractedTitle}`);
      console.log(`[CS] Text length: ${extractedText.length} characters`);
      console.log("[CS] Full text:");
      console.log(extractedText);
      console.log("[CS] ========== END EXTRACTED TEXT ==========");

      // Send extracted to SW
      sendResponse({
        ok: true,
        text: extractedText,
        title: extractedTitle,
      });
    } catch (err) {
      console.error("[CS] Extraction failed:", err);
      sendResponse({
        ok: false,
        error: `Error Extracting Text: ${err}`,
        title: document.title || "",
        text: document.body.innerText || "",
      });
    }
  }
  if (request.type === "HIGHLIGHT_CLEAR") {
    try {
      const removed = clearHighlights();
      sendResponse({ ok: true, removed });
    } catch (e) {
      console.log(`Error clearing highlights: ${e}`);
      sendResponse({
        ok: false,
        error: `Error clearing highlights: ${e}`,
      });
    }
    return;
  }
  if (request.type === "HIGHLIGHT_APPLY") {
    try {
      const hits: Hit[] = Array.isArray(request.hits) ? request.hits : [];
      const applied = applyHighlights(hits);
      sendResponse({ ok: true, applied, capped: applied >= MAX_HIGHLIGHTS });
    } catch (e) {
      console.log(`Error applying highlights: ${e}`);
      sendResponse({
        ok: false,
        error: `Error applying highlights: ${e}`,
      });
    }
    return;
  }
});
