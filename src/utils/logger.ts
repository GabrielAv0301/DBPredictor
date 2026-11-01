/**
 * Logging facade. The extension wires it to a VS Code LogOutputChannel; in
 * tests it stays silent. Every message is scrubbed of connection strings and
 * passwords before reaching the sink.
 */

export interface LogSink {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

const SENSITIVE_KEY =
    /pass(word)?|secret|token|connection(string)?|credential|authorization|apikey/i;

/** Removes credentials from any text: URLs with user info and `password=` pairs. */
export function redact(text: string): string {
    return text
        .replace(/(postgres(?:ql)?:\/\/)[^\s'"`]*/gi, '$1***')
        .replace(/(password|pwd)\s*[=:]\s*[^\s&;'"`]+/gi, '$1=***');
}

function stringify(data: unknown): string {
    if (data === undefined) return '';
    if (data instanceof Error) return data.stack ?? `${data.name}: ${data.message}`;
    if (typeof data === 'string') return data;
    const seen = new WeakSet<object>();
    try {
        return JSON.stringify(data, (key, value: unknown) => {
            if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
            if (value instanceof Error) return { name: value.name, message: value.message };
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
            }
            return value;
        });
    } catch {
        return String(data);
    }
}

export class Logger {
    private static sink: LogSink | undefined;

    public static setSink(sink: LogSink | undefined): void {
        this.sink = sink;
    }

    public static info(message: string, data?: unknown): void {
        this.sink?.info(this.format(message, data));
    }

    public static warn(message: string, data?: unknown): void {
        this.sink?.warn(this.format(message, data));
    }

    public static error(message: string, data?: unknown): void {
        this.sink?.error(this.format(message, data));
    }

    public static debug(message: string, data?: unknown): void {
        this.sink?.debug(this.format(message, data));
    }

    private static format(message: string, data: unknown): string {
        const details = stringify(data);
        return redact(details ? `${message} | ${details}` : message);
    }
}
