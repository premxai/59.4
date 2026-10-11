import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Lists public/replays/*.json at /replays/index.json (dev middleware + emitted at build),
// so the viewer can pick a default replay without a backend.
function replayIndex(): Plugin {
  const dir = join(import.meta.dirname, "public", "replays");
  const list = () =>
    existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort()
      : [];
  return {
    name: "replay-index",
    configureServer(server) {
      server.middlewares.use("/replays/index.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ files: list() }));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "replays/index.json", source: JSON.stringify({ files: list() }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), replayIndex()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 2000 },
});
