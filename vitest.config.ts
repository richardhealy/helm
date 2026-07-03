import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    // Integration tests share one Postgres and some operate on global state
    // (e.g. dispatchFleet, LISTEN/NOTIFY). Run files sequentially so they don't
    // stomp each other's rows or notifications.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
