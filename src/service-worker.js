import { rulesScan } from "./rules"; //TODO: TS types
// Open the Side panel when the user clicks the toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- Helpers ---------------------------------------------------------
// Get the current active tab
async function getCurrentTab() {
  let queryOptions = { active: true, lastFocusedWindow: true };
  // tab will either be a tabs.Tab instance or undefined.
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

// Inject content script into a tab (if it's not already there)
async function ensureContentScript(tabId) {
  // Try pinging the CS. If it replies, it's already there
  try {
    const pingResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "PING",
    });
    if (pingResponse?.ok) return; // CS already there
  } catch {
    console.debug("No CS yet, injecting now…");
    // Land here if no CS is injected yet.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  console.log("[SW] CS injected");
}

// Offscreen ensure/create
let creating;
async function ensureOffScreen(path) {
  const offscreenUrl = chrome.runtime.getURL(path);
  const existing = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  if (existing?.length) return;

  if (creating) await creating;
  else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ["IFRAME_SCRIPTING"],
      justification: "Run local summarization",
    });
    await creating;
    creating = null;
  }
}

async function offscreenWarmup() {
  await ensureOffScreen("offscreen.html");
  try {
    const warmRes = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_WARMUP",
    });
    console.log("[SW] Warmup response:", warmRes);
    return !!warmRes?.ok;
  } catch (e) {
    console.error("[SW] Warmup failed:", e);
    return false;
  }
}

// ---------- Message handler -----------------------------------------
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type !== "ANALYZE_REQUEST") return;
  else {
    (async () => {
      try {
        // kick warmup in parallel (don’t block)
        offscreenWarmup().catch(() => {});

        const tab = await getCurrentTab();
        await ensureContentScript(tab.id);

        const extractResponse = await chrome.tabs.sendMessage(tab.id, {
          type: "EXTRACT_REQUEST",
        }); // Receiver: Content Script
        if (!extractResponse?.ok) {
          sendResponse({
            ok: false,
            error: extractResponse?.error || "Extraction failed",
          });
          return;
        }

        const rulesRes = rulesScan(extractResponse.text);

        const clearHighlightRes = await chrome.tabs.sendMessage(tab.id, {
          type: "HIGHLIGHT_CLEAR",
        }); // Receiver: Content Script
        if (!clearHighlightRes?.ok) {
          sendResponse({
            ok: false,
            error: clearHighlightRes?.error || "Clear highlights failed", // TODO: Check about sending error messages through multiple layers of message passing
          });
          return;
        }

        const applyHighlightRes = await chrome.tabs.sendMessage(tab.id, {
          type: "HIGHLIGHT_APPLY",
          hits: rulesRes.hits,
        }); // Receiver: Content Script
        if (!applyHighlightRes?.ok) {
          sendResponse({
            ok: false,
            error: applyHighlightRes?.error || "Apply highlights failed", // TODO: Check about sending error messages through multiple layers of message passing
          });
          return;
        }

        // Send partial to panel UI
        chrome.runtime.sendMessage({
          type: "ANALYZE_PARTIAL",
          partial: {
            severity: rulesRes.severity,
            hero: rulesRes.hero || "",
            heatmap: rulesRes.heatmap,
          },
        }); // Receiver: Panel UI

        // Extract only sentences containing highlighted phrases for AI summarization
        // Filter to only include user-relevant risks: fees, cancellation, auto_renewal
        // Exclude arbitration and class_action (legal jargon that users care less about)
        const relevantHits = rulesRes.hits?.filter(h =>
          h.type === 'fees' || h.type === 'cancellation' || h.type === 'auto_renewal'
        ) || [];
        const highlightedSnippets = relevantHits.map(h => h.snippet);
        console.log("[SW] Sending highlighted snippets to AI summarizer");
        console.log(`[SW] Total hits: ${rulesRes.hits?.length || 0}, Relevant for AI: ${highlightedSnippets.length}`);

        // Call AI summarization with highlighted snippets only
        const summarizeResponse = await chrome.runtime.sendMessage({
          type: "OFFSCREEN_SUMMARIZE",
          payload: {
            title: extractResponse.title || "Terms & Conditions",
            snippets: highlightedSnippets, // Send only user-relevant content
            detectedRisks: relevantHits.map(h => h.type), // Tell model what we found
          },
        }); // Receiver: Offscreen AI
        console.log("[SW] Summarize response:", summarizeResponse);

        // Send summary bullets to panel UI if successful
        if (summarizeResponse?.ok && summarizeResponse.bullets) {
          chrome.runtime.sendMessage({
            type: "ANALYZE_COMPLETE",
            bullets: summarizeResponse.bullets,
          }); // Receiver: Panel UI
        }

        // Return status to panel (minimal)
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  } // keep channel open while awaiting
});
