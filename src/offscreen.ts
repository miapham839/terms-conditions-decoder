import { pipeline, SummarizationPipeline, env } from "@xenova/transformers";

// ═══════════════════════════════════════════════════════════════════════════
// Transformers.js Configuration for Chrome Extension
// ═══════════════════════════════════════════════════════════════════════════

// IMPORTANT: Configure Transformers.js to work in Chrome extension environment
// Use remote CDN models and disable local model loading
env.allowLocalModels = false; // Force use of remote models from HuggingFace CDN
env.allowRemoteModels = true; // Enable downloading from HuggingFace
env.useBrowserCache = true; // Use browser's cache API for model storage

// CRITICAL: Configure ONNX runtime to avoid Web Worker issues in Chrome extensions
// Chrome extensions can't use blob: URLs for importScripts in workers
env.backends.onnx.wasm.numThreads = 1; // Single-threaded WASM (no workers)
env.backends.onnx.wasm.proxy = false; // Disable worker proxy

console.log("[Offscreen] Transformers.js config:", {
  allowLocalModels: env.allowLocalModels,
  allowRemoteModels: env.allowRemoteModels,
  useBrowserCache: env.useBrowserCache,
  onnxNumThreads: env.backends.onnx.wasm.numThreads,
  onnxProxy: env.backends.onnx.wasm.proxy,
});

// ═══════════════════════════════════════════════════════════════════════════
// Model Singleton Loader
// ═══════════════════════════════════════════════════════════════════════════

type ModelState = {
  generator: SummarizationPipeline | null;
  loading: Promise<SummarizationPipeline> | null;
  error: Error | null;
};

const state: ModelState = {
  generator: null,
  loading: null,
  error: null,
};

// Model selection: DistilBART for summarization
// DistilBART is distilled from BART, specifically trained on CNN/DailyMail summarization
// It's faster than BART-large while maintaining good quality for document summarization
// - Xenova/distilbart-cnn-6-6 - 306M params, good balance of quality and speed
const MODEL_NAME = "Xenova/distilbart-cnn-6-6";

/**
 * Get or load the summarization model (singleton pattern).
 * Handles concurrent requests gracefully by reusing the same loading promise.
 */
async function getGenerator(): Promise<SummarizationPipeline> {
  console.log("[Offscreen] getGenerator called");

  // Already loaded
  if (state.generator) {
    console.log("[Offscreen] Model already loaded, reusing");
    return state.generator;
  }

  // Already loading - wait for existing promise
  if (state.loading) {
    console.log("[Offscreen] Model already loading, waiting for completion");
    return state.loading;
  }

  // Start loading
  console.log(`[Offscreen] Loading model: ${MODEL_NAME}`);
  console.log("[Offscreen] This may take 1-2 minutes on first run...");

  state.loading = (async () => {
    try {
      const startTime = Date.now();

      // Use summarization pipeline for DistilBART model
      const generator = await pipeline("summarization", MODEL_NAME, {
        // Use cache for subsequent loads
        progress_callback: (progress: any) => {
          if (progress.status === "progress") {
            const percent = Math.round(
              (progress.loaded / progress.total) * 100
            );
            console.log(
              `[Offscreen] Downloading ${progress.file}: ${percent}%`
            );
          } else if (progress.status === "done") {
            console.log(`[Offscreen] Downloaded ${progress.file}`);
          }
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Offscreen] Model loaded successfully in ${elapsed}s`);

      state.generator = generator as SummarizationPipeline;
      state.error = null;
      return state.generator;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[Offscreen] Model loading failed:", error);
      state.error = error;
      throw error;
    } finally {
      state.loading = null;
    }
  })();

  return state.loading;
}

// ═══════════════════════════════════════════════════════════════════════════
// Summarization Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a consumer-friendly summary from full T&C text.
 * Returns 5-8 clear bullet points about user rights and obligations.
 */
async function summarize(params: {
  title: string;
  fullText?: string;
  snippets?: string[];
  detectedRisks?: string[];
}): Promise<{ bullets: string[] }> {
  const { title, fullText, snippets = [], detectedRisks = [] } = params;

  console.log("[Offscreen] Starting summarization");
  console.log(`[Offscreen] Title: ${title}`);
  console.log(`[Offscreen] Using full text: ${!!fullText}`);
  console.log(`[Offscreen] Detected risks: ${detectedRisks.join(", ")}`);

  const generator = await getGenerator();

  // Use snippets containing highlighted risky clauses
  console.log(`[Offscreen] Processing ${snippets.length} highlighted snippets`);

  // Filter and combine snippets
  const validSnippets = snippets
    .filter((s) => s && s.length > 30) // Filter out very short snippets
    .map((s) => s.trim());

  console.log(`[Offscreen] Valid snippets: ${validSnippets.length}`);

  if (validSnippets.length === 0) {
    console.warn("[Offscreen] No valid snippets to summarize");
    return {
      bullets: ["No significant terms detected in this document."],
    };
  }

  // Combine sentence snippets with separators, respecting DistilBART's token limit
  // DistilBART can handle ~1024 tokens input (~4000 characters)
  const maxChars = 4000;
  let combinedText = "";
  let snippetCount = 0;

  for (const snippet of validSnippets) {
    const withSeparator = combinedText ? " " + snippet : snippet;
    if ((combinedText + withSeparator).length > maxChars) {
      break; // Stop before exceeding limit
    }
    combinedText += withSeparator;
    snippetCount++;
  }

  console.log(
    `[Offscreen] Using ${snippetCount} sentence snippets (${combinedText.length} chars)`
  );

  // Create summarization prompt for DistilBART
  const inputText = `Summarize the key consumer rights and obligations in these Terms and Conditions sentences:\n\n${combinedText}`;

  console.log("[Offscreen] Generating summary...");

  const startTime = Date.now();

  try {
    // DistilBART summarization
    const result = await generator(inputText, {
      max_length: 300, // Maximum summary length
      min_length: 100, // Minimum summary length
      do_sample: false, // Use greedy decoding for factual accuracy
      num_beams: 4, // Use beam search for better quality
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Offscreen] Generation completed in ${elapsed}s`);

    // Extract generated text from BART output
    let generatedText = "";
    if (Array.isArray(result) && result.length > 0) {
      const firstResult = result[0];
      if (firstResult && "summary_text" in firstResult) {
        generatedText = firstResult.summary_text || "";
      }
    }

    console.log(
      "[Offscreen] Generated output:",
      generatedText.substring(0, 300)
    );

    // Convert generated text into bullet points
    const bullets = convertGeneratedTextToBullets(generatedText);

    console.log(`[Offscreen] Extracted ${bullets.length} bullets`);
    return { bullets };
  } catch (err) {
    console.error("[Offscreen] Summarization failed:", err);
    throw err;
  }
}

/**
 * Convert DistilBART generated text into structured bullet points.
 * DistilBART outputs a paragraph summary, we need to parse and clean them.
 */
function convertGeneratedTextToBullets(generatedText: string): string[] {
  if (!generatedText || generatedText.length < 20) {
    return ["Unable to generate summary from this document."];
  }

  console.log(
    "[Offscreen] Parsing generated text:",
    generatedText.substring(0, 500)
  );

  // DistilBART might output bullets in various formats:
  // - "1. Text"
  // - "- Text"
  // - "• Text"
  // Or just paragraphs/sentences

  const bullets: string[] = [];

  // Try to split by bullet markers first
  const bulletPatterns = [
    /(?:^|\n)\s*[-•*]\s+(.+?)(?=\n\s*[-•*]|\n\n|$)/gs, // Dash/bullet markers
    /(?:^|\n)\s*(\d+)\.\s+(.+?)(?=\n\s*\d+\.|\n\n|$)/gs, // Numbered lists
  ];

  for (const pattern of bulletPatterns) {
    const matches = [...generatedText.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const text = (match[2] || match[1]).trim();
        if (text.length >= 20) {
          bullets.push(text);
        }
      }
      if (bullets.length > 0) break; // Found bullets, stop searching
    }
  }

  // If no bullets found, split by sentences
  if (bullets.length === 0) {
    const sentences = generatedText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);

    bullets.push(...sentences.slice(0, 8));
  }

  // Clean up bullets
  const cleanedBullets = bullets
    .map((bullet) => {
      return bullet
        .replace(/^\s*[-•*]\s*/, "") // Remove bullet markers
        .replace(/^\d+\.\s*/, "") // Remove numbers
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();
    })
    .filter((b) => b.length >= 15) // Filter very short bullets
    .slice(0, 8); // Max 8 bullets

  if (cleanedBullets.length === 0) {
    return ["Unable to extract key points from this document."];
  }

  console.log("[Offscreen] Extracted bullets:", cleanedBullets);
  return cleanedBullets;
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Handlers
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log("[Offscreen] Received message:", request.type);

  if (request.type === "OFFSCREEN_WARMUP") {
    (async () => {
      try {
        console.log("[Offscreen] WARMUP requested");
        await getGenerator();
        console.log("[Offscreen] WARMUP complete");
        sendResponse({ ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[Offscreen] WARMUP failed:", error);
        sendResponse({ ok: false, error });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (request.type === "OFFSCREEN_SUMMARIZE") {
    (async () => {
      try {
        console.log("[Offscreen] SUMMARIZE requested");

        const {
          title = "Terms & Conditions",
          fullText,
          snippets = [],
          detectedRisks = [],
        } = request.payload || {};

        // Check if we have either full text or snippets
        if (!fullText && (!Array.isArray(snippets) || snippets.length === 0)) {
          console.warn("[Offscreen] No text provided for summarization");
          sendResponse({
            ok: true,
            bullets: ["No content available to analyze."],
            usage: null,
          });
          return;
        }

        const result = await summarize({
          title,
          fullText,
          snippets,
          detectedRisks,
        });

        console.log("[Offscreen] SUMMARIZE complete");
        sendResponse({
          ok: true,
          bullets: result.bullets,
          usage: null,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[Offscreen] SUMMARIZE failed:", error);
        sendResponse({ ok: false, error });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Unknown message type - don't handle it
  return false;
});
