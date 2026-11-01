/**
 * Minimal BDD runner for the extension host. Mocha ≥ 12 is ESM-only and needs
 * Node ≥ 20, but the minimum supported VS Code (1.85) runs extensions on Node 18.
 */
import * as fs from 'fs';
import * as path from 'path';

type Fn = () => unknown | Promise<unknown>;
interface Test {
    name: string;
    fn: Fn;
}
interface Suite {
    name: string;
    before: Fn[];
    tests: Test[];
}

const suites: Suite[] = [];
let current: Suite | undefined;

const g = globalThis as Record<string, unknown>;
g.describe = (name: string, body: () => void) => {
    current = { name, before: [], tests: [] };
    suites.push(current);
    body();
    current = undefined;
};
g.before = (fn: Fn) => current?.before.push(fn);
g.it = (name: string, fn: Fn) => current?.tests.push({ name, fn });

const TIMEOUT_MS = 30_000;

function withTimeout(fn: Fn, name: string): Promise<unknown> {
    return Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`Timeout after ${TIMEOUT_MS} ms: ${name}`)),
                TIMEOUT_MS
            )
        ),
    ]);
}

export async function run(): Promise<void> {
    for (const file of fs.readdirSync(__dirname)) {
        if (file.endsWith('.test.js')) require(path.join(__dirname, file));
    }
    let failures = 0;
    let passes = 0;
    for (const suite of suites) {
        console.log(`\n  ${suite.name}`);
        try {
            for (const hook of suite.before) await withTimeout(hook, 'before hook');
        } catch (error) {
            console.log(`    ✗ before hook failed: ${String(error)}`);
            failures += suite.tests.length;
            continue;
        }
        for (const test of suite.tests) {
            const started = Date.now();
            try {
                await withTimeout(test.fn, test.name);
                passes++;
                console.log(`    ✔ ${test.name} (${Date.now() - started} ms)`);
            } catch (error) {
                failures++;
                console.log(
                    `    ✗ ${test.name}\n      ${error instanceof Error ? error.stack : String(error)}`
                );
            }
        }
    }
    console.log(`\n  ${passes} passing, ${failures} failing\n`);
    if (failures > 0) throw new Error(`${failures} end-to-end test(s) failed.`);
}
