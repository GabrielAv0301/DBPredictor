interface MeterProps {
    value: number;
    total: number;
    label: string;
}

/** Share of the table affected by the statement (SVG ring, theme-aware). */
export function Meter({ value, total, label }: MeterProps) {
    const ratio = total > 0 ? Math.min(1, value / total) : value > 0 ? 1 : 0;
    const percent = Math.round(ratio * 1000) / 10;
    const shown = ratio > 0 && percent < 0.1 ? '<0.1' : String(percent);
    const radius = 34;
    const circumference = 2 * Math.PI * radius;
    const tone = ratio >= 0.5 ? 'danger' : ratio > 0.05 ? 'warn' : 'ok';

    return (
        <figure className="meter" aria-label={`${label}: ${shown}%`}>
            <svg viewBox="0 0 80 80" role="img" aria-hidden="true">
                <circle className="meter-track" cx="40" cy="40" r={radius} />
                <circle
                    className={`meter-value ${tone}`}
                    cx="40"
                    cy="40"
                    r={radius}
                    strokeDasharray={`${ratio * circumference} ${circumference}`}
                    transform="rotate(-90 40 40)"
                />
            </svg>
            <figcaption>
                <strong>{shown}%</strong>
                <span>{label}</span>
            </figcaption>
        </figure>
    );
}
