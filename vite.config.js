// vite.config.js
import { defineConfig } from "vite";
import copy from "rollup-plugin-copy";

export default defineConfig({
  esbuild: {
    target: "esnext",
  },
  build: {
    target: "esnext",
    outDir: "dist",
    modulePreload: false,
  },
  plugins: [
    copy({
      targets: [{ src: "src/routes/*", dest: "dist/routes" }],
      hook: "writeBundle",
    }),
  ],
});
