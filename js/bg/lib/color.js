export function hexToRgb(hex) {
    const clean = hex.replace('#', '').trim();
    const full = clean.length === 3
        ? clean
            .split('')
            .map((char) => char + char)
            .join('')
        : clean.padEnd(6, '0').slice(0, 6);
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
    };
}
export function rgbToHex({ r, g, b }) {
    const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}
export function mixColors(from, to, amount) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    const t = Math.max(0, Math.min(1, amount));
    return rgbToHex({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
    });
}
/** Evenly sampled ramp between two colors, inclusive of both ends. */
export function colorRamp(from, to, steps) {
    const count = Math.max(1, Math.floor(steps));
    if (count === 1) {
        return [from];
    }
    return Array.from({ length: count }, (_, index) => mixColors(from, to, index / (count - 1)));
}
/** Three-stop ramp, useful for tools with a mid accent color. */
export function tripleRamp(from, mid, to, steps) {
    const count = Math.max(1, Math.floor(steps));
    if (count === 1) {
        return [mid];
    }
    return Array.from({ length: count }, (_, index) => {
        const t = index / (count - 1);
        return t < 0.5 ? mixColors(from, mid, t * 2) : mixColors(mid, to, (t - 0.5) * 2);
    });
}
export function hslToHex(hue, saturation, lightness) {
    const h = ((hue % 360) + 360) % 360;
    const s = Math.max(0, Math.min(1, saturation));
    const l = Math.max(0, Math.min(1, lightness));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60
        ? [c, x, 0]
        : h < 120
            ? [x, c, 0]
            : h < 180
                ? [0, c, x]
                : h < 240
                    ? [0, x, c]
                    : h < 300
                        ? [x, 0, c]
                        : [c, 0, x];
    return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}
export function withAlpha(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${round(a)})`;
}
function round(value) {
    return Math.round(value * 1000) / 1000;
}
