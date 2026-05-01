import * as vscodeModule from 'vscode';

// Handle cases where vscode might not be available (e.g., in worker threads)
let vscode: typeof vscodeModule | undefined;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    vscode = require('vscode');
} catch {
    vscode = undefined;
}

export class Logger {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static channel: any;
    private static sensitiveKeys = [
        'password',
        'secret',
        'token',
        'connectionstring',
        'url',
        'key',
    ];

    public static init() {
        if (!this.channel && vscode?.window) {
            this.channel = vscode.window.createOutputChannel('QueryGuard');
        }
    }

    public static info(message: string, data?: unknown) {
        this.log('INFO', message, data);
    }

    public static warn(message: string, data?: unknown) {
        this.log('WARN', message, data);
    }

    public static error(message: string, error?: unknown) {
        this.log('ERROR', message, error);
    }

    private static safeStringify(data: unknown): string {
        const cache = new Set();
        return JSON.stringify(data, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) {
                    return '[Circular]';
                }
                cache.add(value);
            }
            if (
                typeof key === 'string' &&
                Logger.sensitiveKeys.some((k) => key.toLowerCase().includes(k))
            ) {
                return '[REDACTED]';
            }
            if (value instanceof Error) {
                return { message: value.message, stack: value.stack, name: value.name };
            }
            return value;
        });
    }

    private static log(level: string, message: string, data?: unknown) {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | ${this.safeStringify(data)}` : '';
        const fullMessage = `[${timestamp}] [${level}] ${message}${dataStr}`;

        if (this.channel) {
            this.channel.appendLine(fullMessage);
        } else {
            if (level === 'ERROR') {
                // eslint-disable-next-line no-console
                console.error(fullMessage);
            } else if (level === 'WARN') {
                // eslint-disable-next-line no-console
                console.warn(fullMessage);
            } else {
                // eslint-disable-next-line no-console
                console.log(fullMessage);
            }
        }
    }

    public static show() {
        if (this.channel) {
            this.channel.show();
        }
    }
}
