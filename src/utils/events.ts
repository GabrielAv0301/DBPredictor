export interface Disposable {
    dispose(): void;
}

export type Event<T> = (listener: (value: T) => void) => Disposable;

/** Minimal event emitter compatible with `vscode.Event` (usable without the VS Code API). */
export class Emitter<T> implements Disposable {
    private listeners = new Set<(value: T) => void>();

    public readonly event: Event<T> = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };

    public fire(value: T): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(value);
            } catch {
                // A failing listener must not break the others.
            }
        }
    }

    public dispose(): void {
        this.listeners.clear();
    }
}
