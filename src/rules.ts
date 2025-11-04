import type { Hit, RiskType, Heatmap, RulesResult } from "./types";

// ----------------------------- Tunables -----------------------------

/** Context chars to include around a hit when building snippets. */
// Increased from 100 to 250 to give AI model more context for summarization
const SNIPPET_WINDOW = 250;

/** Maximum number of highlights to return (avoid DOM overload). */
const MAX_HIGHLIGHTS = 50;

// ---------------------------- Regex bank ----------------------------
// Keep these simple and explainable. All use /gi to be global + case-insensitive.

const RE = {
  AUTO_RENEW: /(auto[-\s]?renew(?:al)?|automatically\s+renews?)/gi,
  CANCELLATION: /\bcancel(?:lation)?\b|\bterminate\b/gi,
  ARBITRATION: /\barbitration\b|\bAAA\b|\bJAMS\b/gi,
  CLASS_ACTION:
    /\bclass\s+action\b[\s\S]{0,80}\b(waiver|prohibit(?:ed)?|release|not\s+allowed)\b/gi,
  FEES: /\bfee(?:s)?\b|\bcharge(?:s|d)?\b|\bbilling\b/gi,

  // Helpful context for hero construction
  PRICE: /(\$|£|€)\s?\d{1,4}(?:\.\d{2})?/gi,
  CADENCE:
    /\b(month|mo\.?|monthly|year|yr|annual(?:ly)?|week|wk|day|daily)\b/gi,

  // Data sharing / privacy meter
  THIRD_PARTY: /\bthird[-\s]?party\b/gi,
  SHARE: /\bshare(?:s|d|ing)?\b/gi,
  SELL: /\bsell(?:s|ing|sold)?\b/gi,
  AFFILIATE: /\baffiliate(?:s)?\b/gi,
  PARTNER: /\bpartner(?:s)?\b/gi,
  ADVERTISING: /\badvertis(?:ing|ers?)\b/gi,
  ANALYTICS: /\banalytic(?:s|al)\b/gi,

  // Recipient phrase heuristics
  SHARE_WITH: /\bshare(?:s|d|ing)?\s+(?:with|to)\s+([a-z][a-z\s-]{1,40})/gi,
  SELL_TO: /\bsell(?:s|ing|sold)?\s+(?:to|with)\s+([a-z][a-z\s-]{1,40})/gi,
  OUR_SOMETHING_PARTNERS: /\bour\s+([a-z][a-z\s-]{0,20}\s+partners)\b/gi,
};

// --------------------------- Small helpers --------------------------

/** Count all matches of a regex. Ensures global flag. */
function countMatches(regex: RegExp, text: string): number {
  const r = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : regex.flags + "g"
  );
  let n = 0;
  while (r.exec(text)) n++;
  return n;
}

/** Return all matches with their start index and matched text. */
function findAll(
  regex: RegExp,
  text: string
): Array<{ index: number; match: string }> {
  const r = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : regex.flags + "g"
  );
  const out: Array<{ index: number; match: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) {
    out.push({ index: m.index, match: m[0] });
  }
  return out;
}

/** Makes a readable snippet around [start, end) - extracts ONLY the sentence containing the keyword */
function makeSnippet(
  text: string,
  start: number,
  end: number,
  window = SNIPPET_WINDOW
): string {
  // Strategy: Extract only the sentence containing the keyword hit
  // Find sentence boundaries (periods, question marks, exclamation marks)

  // Get a reasonable window around the hit to search for sentence boundaries
  const searchWindow = 500;
  const searchStart = Math.max(0, start - searchWindow);
  const searchEnd = Math.min(text.length, end + searchWindow);
  const region = text.slice(searchStart, searchEnd);

  // Find sentence boundaries (. ! ? followed by space/newline/end)
  const sentenceEndings = /[.!?](?:\s|$)/g;
  const boundaries: number[] = [0]; // Start of region

  let match;
  while ((match = sentenceEndings.exec(region))) {
    boundaries.push(match.index + 1); // Position after the punctuation + space
  }
  boundaries.push(region.length); // End of region

  // Find which sentence contains our keyword hit
  const hitOffsetInRegion = start - searchStart;
  let sentenceStart = 0;
  let sentenceEnd = region.length;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const boundaryStart = boundaries[i];
    const boundaryEnd = boundaries[i + 1];

    if (boundaryStart <= hitOffsetInRegion && hitOffsetInRegion < boundaryEnd) {
      sentenceStart = boundaryStart;
      sentenceEnd = boundaryEnd;
      break;
    }
  }

  // Extract the sentence
  let sentence = region.slice(sentenceStart, sentenceEnd).trim();

  // If sentence is too short or too long, fall back to character window
  if (sentence.length < 30) {
    const fallbackStart = Math.max(0, start - window);
    const fallbackEnd = Math.min(text.length, end + window);
    sentence = text.slice(fallbackStart, fallbackEnd).trim();
  }

  // Limit to max 500 chars per sentence
  if (sentence.length > 500) {
    const hitOffset = start - searchStart - sentenceStart;
    const excerptStart = Math.max(0, hitOffset - 250);
    const excerptEnd = Math.min(sentence.length, hitOffset + 250);
    sentence = sentence.slice(excerptStart, excerptEnd).trim();

    if (excerptStart > 0) sentence = "…" + sentence;
    if (excerptEnd < sentence.length) sentence = sentence + "…";
  }

  return sentence;
}

function dedupeOverlaps(hits: Hit[]): Hit[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];

  for (const h of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(h);
      continue;
    }
    const overlaps =
      h.start <= last.end && h.end >= last.start;
    if (!overlaps) {
      out.push(h);
      continue;
    }
    // prefer the longer span, otherwise keep the first
    const lastLen = last.end - last.start;
    const thisLen = h.end - h.start;
    if (thisLen > lastLen) {
      out[out.length - 1] = h;
    }
  }

  return out;
}

/** Try to find a price and cadence near a given range (for hero line). */
function findPriceAndCadenceNearby(
  text: string,
  start: number,
  end: number,
  window = 160
) {
  const a = Math.max(0, start - window);
  const b = Math.min(text.length, end + window);
  const area = text.slice(a, b);

  const price = (area.match(RE.PRICE) || [])[0];
  const cadence = (area.match(RE.CADENCE) || [])[0];

  return {
    price: price ? price.trim() : undefined,
    cadence: cadence ? cadence.toLowerCase().trim() : undefined,
  };
}

/** Map numeric score to severity label. */
function scoreToSeverity(score: number): "Low" | "Medium" | "High" {
  if (score >= 4) return "High";
  if (score >= 2) return "Medium";
  return "Low";
}

// ------------------------ Heatmap & recipients ----------------------

function buildHeatmap(text: string): Heatmap {
  const counts = {
    third_party: countMatches(RE.THIRD_PARTY, text),
    share: countMatches(RE.SHARE, text),
    sell: countMatches(RE.SELL, text),
    affiliate: countMatches(RE.AFFILIATE, text),
    partner: countMatches(RE.PARTNER, text),
    advertising: countMatches(RE.ADVERTISING, text),
    analytics: countMatches(RE.ANALYTICS, text),
  };

  const total =
    counts.third_party +
    counts.share +
    counts.sell +
    counts.affiliate +
    counts.partner +
    counts.advertising +
    counts.analytics;

  const level: Heatmap["level"] =
    total >= 15 ? "High" : total >= 5 ? "Medium" : "Low";

  // Recipient heuristics
  const topMap = new Map<string, number>();
  function bump(phrase?: string) {
    if (!phrase) return;
    const p = phrase.toLowerCase().replace(/\s+/g, " ").trim();
    if (!p) return;
    topMap.set(p, (topMap.get(p) || 0) + 1);
  }

  let m: RegExpExecArray | null;
  const shareWith = new RegExp(RE.SHARE_WITH.source, "gi");
  while ((m = shareWith.exec(text))) bump(m[1]);
  const sellTo = new RegExp(RE.SELL_TO.source, "gi");
  while ((m = sellTo.exec(text))) bump(m[1]);
  const partners = new RegExp(RE.OUR_SOMETHING_PARTNERS.source, "gi");
  while ((m = partners.exec(text))) bump(m[1]);

  const topRecipients = [...topMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => ({ phrase, count }));

  return { counts, level, topRecipients };
}

// ------------------------- Severity & hero --------------------------

function computeSeverity(
  hits: Hit[],
  fullText: string
): "Low" | "Medium" | "High" {
  let score = 0;

  const has = (t: RiskType) => hits.some((h) => h.type === t);

  // Auto-renewal gets more weight when it's specific (price/cadence nearby)
  const auto = hits.find((h) => h.type === "auto_renewal");
  if (auto) {
    const near = findPriceAndCadenceNearby(fullText, auto.start, auto.end);
    score += near.price || near.cadence ? 3 : 2;
  }

  if (has("arbitration")) score += 3;
  if (has("class_action")) score += 2;
  if (has("cancellation")) score += 1;
  if (has("fees")) score += 1;

  return scoreToSeverity(score);
}

function selectHero(hits: Hit[], fullText: string): string | undefined {
  // Focus on fees and cancellation - what users care about most

  // 1) Fees - highest priority for user awareness
  if (hits.some((h) => h.type === "fees")) {
    return "💰 Fees/charges apply - review billing terms carefully.";
  }

  // 2) Cancellation terms
  if (hits.some((h) => h.type === "cancellation")) {
    return "🔄 Cancellation restrictions found - check how to cancel.";
  }

  // 3) Auto-renewal (often tied to fees/cancellation)
  const auto = hits.find((h) => h.type === "auto_renewal");
  if (auto) {
    const near = findPriceAndCadenceNearby(fullText, auto.start, auto.end);
    if (near.price || near.cadence) {
      const part = [near.price, near.cadence].filter(Boolean).join("/");
      return `Auto-renews ${part ? "at " + part : ""} — set a cancel reminder.`;
    }
    return "⚠️ Auto-renewal detected. Review cancellation terms.";
  }

  return undefined;
}

// ---------------------------- Main entry ----------------------------

export function rulesScan(text: string): RulesResult {
  const hits: Hit[] = [];

  function pushAll(type: RiskType, regex: RegExp) {
    for (const { index, match } of findAll(regex, text)) {
      const start = index;
      const end = index + match.length;
      hits.push({
        type,
        start,
        end,
        text: match,
        snippet: makeSnippet(text, start, end, SNIPPET_WINDOW),
      });
    }
  }

  // Collect raw hits
  pushAll("auto_renewal", RE.AUTO_RENEW);
  pushAll("arbitration", RE.ARBITRATION);
  pushAll("class_action", RE.CLASS_ACTION);
  pushAll("cancellation", RE.CANCELLATION);
  pushAll("fees", RE.FEES);

  // Dedupe & cap for highlight sanity
  let cleaned = dedupeOverlaps(hits);
  if (cleaned.length > MAX_HIGHLIGHTS) {
    cleaned = cleaned.slice(0, MAX_HIGHLIGHTS);
  }

  const heatmap = buildHeatmap(text);
  const severity = computeSeverity(cleaned, text);
  const hero = selectHero(cleaned, text);

  return { hits: cleaned, severity, hero, heatmap };
}
