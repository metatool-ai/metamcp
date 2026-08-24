import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true, // Bundle to resolve imports properly
  keepNames: true,
  minify: false,
  dts: true, // Generate TypeScript declaration files
  external: ["zod"],
});
