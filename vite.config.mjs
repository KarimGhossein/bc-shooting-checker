import { defineConfig } from "vite";

// Deliberately minimal for now: index.html is still the pre-migration
// single-file app (see docs/PLAN.md), so there's nothing to bundle yet.
// This config's only job right now is to give `npm run dev` / `npm run
// build` a real, working entry point *before* the module split starts,
// so every extraction from here on can be built and tested at each step
// instead of only at the end.
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
