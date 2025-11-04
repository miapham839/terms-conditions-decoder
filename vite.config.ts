import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Build the Side Panel page (was index.html)
        sidepanel: resolve(__dirname, "sidepanel.html"),
        // Build the Content Script bundle
        content: resolve(__dirname, "src/content.ts"),
        "service-worker": resolve(__dirname, "src/service-worker.js"),
        offscreen: resolve(__dirname, "offscreen.html"),
      },
      output: {
        entryFileNames: (chunk) => {
          // put these at the root of dist:
          if (chunk.name === "service-worker") return "service-worker.js";
          if (chunk.name === "content") return "content.js";
          // everything else can go under assets/
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
