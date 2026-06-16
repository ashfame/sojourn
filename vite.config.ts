import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const buildCommit = process.env.VITE_GIT_COMMIT ?? process.env.GITHUB_SHA ?? "unknown";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  define: {
    __SOJOURN_BUILD_COMMIT__: JSON.stringify(buildCommit)
  },
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"]
  },
  build: {
    sourcemap: true,
    target: "es2024"
  }
});
