// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    target: "esnext",
  },
  build: {
    target: "esnext",
    outDir: "dist",
    modulePreload: false,
  },
});
