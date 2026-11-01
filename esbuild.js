// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: production,
    sourcemap: production ? false : 'linked',
    // Keep third-party license headers (TypeScript, pg) in the bundle.
    legalComments: 'eof',
    // `pg-native` is an optional peer of `pg` that we never use.
    external: ['vscode', 'pg-native'],
    logLevel: 'info',
};

const builds = [
    { ...shared, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' },
    { ...shared, entryPoints: ['src/db/worker.ts'], outfile: 'out/db.worker.js' },
];

(async () => {
    if (watch) {
        const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
        await Promise.all(contexts.map((c) => c.watch()));
        return;
    }
    await Promise.all(builds.map((b) => esbuild.build(b)));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
