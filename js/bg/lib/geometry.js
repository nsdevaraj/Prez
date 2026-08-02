export function round(value, precision = 2) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}
export function point(x, y) {
    return { x, y };
}
export function polar(cx, cy, radius, angleDeg) {
    const angle = (angleDeg * Math.PI) / 180;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
export function polyline(points, close = false) {
    if (points.length === 0) {
        return '';
    }
    const body = points
        .map((p, index) => `${index === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`)
        .join(' ');
    return close ? `${body} Z` : body;
}
/** Catmull-Rom spline converted to cubic beziers for smooth organic shapes. */
export function smoothPath(points, closed = true, tension = 1) {
    if (points.length < 3) {
        return polyline(points, closed);
    }
    const get = (index) => {
        if (closed) {
            return points[(index + points.length) % points.length];
        }
        return points[Math.max(0, Math.min(points.length - 1, index))];
    };
    const segments = closed ? points.length : points.length - 1;
    let path = `M${round(points[0].x)} ${round(points[0].y)}`;
    for (let i = 0; i < segments; i += 1) {
        const p0 = get(i - 1);
        const p1 = get(i);
        const p2 = get(i + 1);
        const p3 = get(i + 2);
        const c1 = {
            x: p1.x + ((p2.x - p0.x) / 6) * tension,
            y: p1.y + ((p2.y - p0.y) / 6) * tension,
        };
        const c2 = {
            x: p2.x - ((p3.x - p1.x) / 6) * tension,
            y: p2.y - ((p3.y - p1.y) / 6) * tension,
        };
        path += ` C${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(p2.x)} ${round(p2.y)}`;
    }
    return closed ? `${path} Z` : path;
}
/** Wavy horizontal line sampled across the given width. */
export function wavePoints(options) {
    const { width, baseline, amplitude, frequency, phase } = options;
    const samples = Math.max(4, Math.floor(options.samples ?? 24));
    const jitter = options.jitter ?? 0;
    const random = options.random;
    return Array.from({ length: samples + 1 }, (_, index) => {
        const t = index / samples;
        const noise = jitter && random ? (random() - 0.5) * jitter : 0;
        return {
            x: t * width,
            y: baseline + Math.sin(t * Math.PI * 2 * frequency + phase) * amplitude + noise,
        };
    });
}
/** Closed organic blob built from radially perturbed points. */
export function blobPoints(options) {
    const { cx, cy, radius, lobes, irregularity, random } = options;
    const squash = options.squash ?? 1;
    const count = Math.max(3, Math.floor(lobes));
    return Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        const r = radius * (1 - irregularity / 2 + random() * irregularity);
        return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r * squash };
    });
}
export function starPoints(options) {
    const { cx, cy, outer, inner, spikes } = options;
    const rotation = options.rotation ?? -90;
    const count = Math.max(2, Math.floor(spikes)) * 2;
    return Array.from({ length: count }, (_, index) => {
        const radius = index % 2 === 0 ? outer : inner;
        return polar(cx, cy, radius, rotation + (index / count) * 360);
    });
}
export function regularPolygon(cx, cy, radius, sides, rotation = -90) {
    const count = Math.max(3, Math.floor(sides));
    return Array.from({ length: count }, (_, index) => polar(cx, cy, radius, rotation + (index / count) * 360));
}
