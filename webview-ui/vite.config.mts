import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the webview bundle into out/webview/{index.js,index.css}.
export default defineConfig({
    root: import.meta.dirname,
    plugins: [react()],
    base: './',
    build: {
        outDir: resolve(import.meta.dirname, '../out/webview'),
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        modulePreload: false,
        sourcemap: false,
        rolldownOptions: {
            input: resolve(import.meta.dirname, 'src/main.tsx'),
            output: {
                entryFileNames: 'index.js',
                chunkFileNames: 'index-[name].js',
                assetFileNames: (asset) =>
                    (asset.names ?? []).some((n) => n.endsWith('.css'))
                        ? 'index.css'
                        : '[name][extname]',
            },
        },
    },
});
