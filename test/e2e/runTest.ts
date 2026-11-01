/**
 * End-to-end tests inside a real VS Code instance, using the production bundle.
 *   npm run build && npm run test:e2e            (VS Code 1.85.0 — minimum engine)
 *   QG_VSCODE_VERSION=stable npm run test:e2e
 */
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '../../../../');
    const fixture = path.join(root, 'test', 'e2e', 'fixture');
    try {
        await runTests({
            version: process.env.QG_VSCODE_VERSION ?? '1.85.0',
            extensionDevelopmentPath: root,
            extensionTestsPath: path.join(__dirname, 'suite', 'index'),
            launchArgs: [fixture, '--disable-extensions', '--disable-workspace-trust'],
        });
    } catch (error) {
        console.error('E2E tests failed', error);
        process.exit(1);
    }
}

void main();
