import * as vscode from 'vscode';

export class Logger {
    private static channel: vscode.OutputChannel;
    private static sensitiveKeys = ['password', 'secret', 'token', 'connectionstring', 'url', 'key'];

    public static init() {
        if (!this.channel) {
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
            if (typeof key === 'string' && Logger.sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
                return '[REDACTED]';
            }
            if (value instanceof Error) {
                return { message: value.message, stack: value.stack, name: value.name };
            }
            return value;
        });
    }

    private static log(level: string, message: string, data?: unknown) {
        if (!this.channel) {
            this.init();
        }
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | ${this.safeStringify(data)}` : '';
        this.channel.appendLine(`[${timestamp}] [${level}] ${message}${dataStr}`);
    }

    public static show() {
        this.channel.show();
    }
}
