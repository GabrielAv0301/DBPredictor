/** Debounces calls per key (e.g. per document URI) so one file never delays another. */
export class KeyedDebouncer<T> {
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly delay: () => number,
        private readonly run: (value: T) => void
    ) {}

    public schedule(key: string, value: T): void {
        this.cancel(key);
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                this.run(value);
            }, this.delay())
        );
    }

    public cancel(key: string): void {
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
    }

    public dispose(): void {
        this.timers.forEach((t) => clearTimeout(t));
        this.timers.clear();
    }
}
