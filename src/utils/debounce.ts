export function debounce<A extends unknown[], R>(
    func: (...args: A) => R,
    wait: number
): (...args: A) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: A): void => {
        if (timeout) {
            clearTimeout(timeout);
        }

        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}
