const esbuild = require("esbuild");

const baseConfig = {
  bundle: true,
  minify: process.argv.includes("--production"),
  sourcemap: !process.argv.includes("--production"),
  platform: "node",
  target: "node18",
  external: ["vscode", "pg-native"], // Excluimos pg-native para evitar fallos de compilación
};

const extensionConfig = {
  ...baseConfig,
  entryPoints: ["./src/extension.ts"],
  outfile: "./out/extension.js",
  format: "cjs",
};

const workerConfig = {
  ...baseConfig,
  entryPoints: ["./src/workers/db.worker.ts"],
  outfile: "./out/workers/db.worker.js",
  format: "cjs",
};

(async () => {
  try {
    await esbuild.build(extensionConfig);
    await esbuild.build(workerConfig);
    console.log("esbuild: Build complete!");
  } catch {
    process.exit(1);
  }
})();
