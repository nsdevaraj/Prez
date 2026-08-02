import { colorControl, rangeControl, selectControl, toggleControl } from '../lib/controls.js';
import { mixColors, tripleRamp } from '../lib/color.js';
import { polar, polyline, regularPolygon, round, smoothPath, wavePoints } from '../lib/geometry.js';
import { times } from '../lib/random.js';
export const wwwhirl = {
    controls: [
        rangeControl('strokes', 'Strokes', 3, 300, 1, 64),
        rangeControl('innerRadius', 'Inner radius', 0, 0.9, 0.01, 0.12),
        rangeControl('outerRadius', 'Outer radius', 0.1, 1.4, 0.01, 0.85),
        rangeControl('whirl', 'Whirl', -180, 180, 1, 55),
        rangeControl('bend', 'Bend', -1, 1, 0.01, 0.4),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 20, 0.2, 2),
        rangeControl('lengthVariation', 'Length variation', 0, 1, 0.01, 0.2),
        colorControl('colorA', 'Color A', '#f8fafc'),
        colorControl('colorB', 'Color B', '#7c3aed'),
        toggleControl('taper', 'Taper strokes', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('strokes'));
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = Math.min(width, height) / 2;
        return times(count, (index) => {
            const t = count === 1 ? 0 : index / (count - 1);
            const angle = t * 360;
            const inner = maxRadius * n('innerRadius');
            const outer = maxRadius * n('outerRadius') * (1 - n('lengthVariation') * random());
            const start = polar(cx, cy, inner, angle);
            const end = polar(cx, cy, outer, angle + n('whirl'));
            const control = polar(cx, cy, (inner + outer) / 2, angle + n('whirl') * (0.5 + n('bend')));
            const strokeWidth = b('taper') ? n('strokeWidth') * (0.25 + t) : n('strokeWidth');
            return `<path d="M${round(start.x)} ${round(start.y)} Q${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}" fill="none" stroke="${mixColors(s('colorA'), s('colorB'), t)}" stroke-width="${round(strokeWidth)}" stroke-linecap="round" />`;
        }).join('\n');
    },
};
export const gggyrate = {
    controls: [
        rangeControl('shapes', 'Shapes', 1, 120, 1, 26),
        rangeControl('sides', 'Sides', 3, 24, 1, 4),
        rangeControl('rotationStep', 'Rotation step', -45, 45, 0.5, 6),
        rangeControl('scaleStep', 'Scale step', 0.5, 1.3, 0.005, 0.94),
        rangeControl('startRadius', 'Start radius', 0.1, 1.2, 0.01, 0.75),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 20, 0.2, 2),
        rangeControl('driftX', 'Drift X', -20, 20, 0.5, 0),
        rangeControl('driftY', 'Drift Y', -20, 20, 0.5, 0),
        colorControl('colorA', 'Color A', '#22d3ee'),
        colorControl('colorB', 'Color B', '#f43f5e'),
        toggleControl('filled', 'Filled', false),
    ],
    render: ({ width, height, n, s, b }) => {
        const count = Math.round(n('shapes'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), count);
        let radius = (Math.min(width, height) / 2) * n('startRadius');
        let rotation = 0;
        let cx = width / 2;
        let cy = height / 2;
        return times(count, (index) => {
            const points = regularPolygon(cx, cy, radius, n('sides'), rotation - 90);
            const paint = b('filled')
                ? `fill="${colors[index]}" fill-opacity="0.35" stroke="${colors[index]}"`
                : `fill="none" stroke="${colors[index]}"`;
            const markup = `<path d="${polyline(points, true)}" ${paint} stroke-width="${round(n('strokeWidth'))}" stroke-linejoin="round" />`;
            radius *= n('scaleStep');
            rotation += n('rotationStep');
            cx += n('driftX');
            cy += n('driftY');
            return markup;
        }).join('\n');
    },
};
export const oooscillate = {
    controls: [
        rangeControl('lines', 'Lines', 1, 120, 1, 32),
        rangeControl('amplitude', 'Amplitude', 0, 200, 1, 30),
        rangeControl('amplitudeGrowth', 'Amplitude growth', -1, 3, 0.05, 1.2),
        rangeControl('frequency', 'Frequency', 0.2, 12, 0.1, 2),
        rangeControl('frequencyGrowth', 'Frequency growth', -1, 2, 0.05, 0),
        rangeControl('phaseShift', 'Phase shift', 0, 2, 0.02, 0.18),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 12, 0.2, 1.5),
        rangeControl('samples', 'Smoothness', 8, 160, 1, 60),
        colorControl('colorA', 'Color A', '#38bdf8'),
        colorControl('colorB', 'Color B', '#c084fc'),
    ],
    render: ({ width, height, n, s }) => {
        const lines = Math.round(n('lines'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), lines);
        const step = height / (lines + 1);
        return times(lines, (index) => {
            const t = lines === 1 ? 0 : index / (lines - 1);
            const points = wavePoints({
                width,
                baseline: step * (index + 1),
                amplitude: n('amplitude') * (1 + n('amplitudeGrowth') * t),
                frequency: Math.max(0.05, n('frequency') * (1 + n('frequencyGrowth') * t)),
                phase: index * n('phaseShift'),
                samples: Math.round(n('samples')),
            });
            return `<path d="${smoothPath(points, false)}" fill="none" stroke="${colors[index]}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" />`;
        }).join('\n');
    },
};
export const cccoil = {
    controls: [
        rangeControl('turns', 'Turns', 1, 40, 0.5, 9),
        rangeControl('segments', 'Segments', 20, 900, 10, 320),
        rangeControl('radius', 'Radius', 0.1, 1.2, 0.01, 0.82),
        rangeControl('innerRadius', 'Inner radius', 0, 0.9, 0.01, 0.05),
        rangeControl('thickness', 'Thickness', 0.5, 60, 0.5, 14),
        rangeControl('thicknessCurve', 'Thickness curve', 0, 3, 0.05, 1),
        rangeControl('wobble', 'Wobble', 0, 80, 1, 0),
        colorControl('colorA', 'Color A', '#fb923c'),
        colorControl('colorB', 'Color B', '#4c1d95'),
        toggleControl('roundCaps', 'Round caps', true),
    ],
    render: ({ width, height, n, s, b }) => {
        const segments = Math.round(n('segments'));
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = (Math.min(width, height) / 2) * n('radius');
        const minRadius = maxRadius * n('innerRadius');
        const cap = b('roundCaps') ? 'round' : 'butt';
        let previous = polar(cx, cy, minRadius, 0);
        const parts = [];
        for (let index = 1; index <= segments; index += 1) {
            const t = index / segments;
            const angle = t * n('turns') * 360;
            const wobble = Math.sin(t * Math.PI * 2 * 6) * n('wobble');
            const radius = minRadius + (maxRadius - minRadius) * t + wobble;
            const current = polar(cx, cy, radius, angle);
            const strokeWidth = Math.max(0.1, n('thickness') * Math.sin(Math.PI * t) ** n('thicknessCurve'));
            parts.push(`<path d="M${round(previous.x)} ${round(previous.y)} L${round(current.x)} ${round(current.y)}" fill="none" stroke="${mixColors(s('colorA'), s('colorB'), t)}" stroke-width="${round(strokeWidth)}" stroke-linecap="${cap}" />`);
            previous = current;
        }
        return parts.join('\n');
    },
};
export const ssspiral = {
    controls: [
        selectControl('type', 'Spiral type', [
            { value: 'archimedean', label: 'archimedean' },
            { value: 'logarithmic', label: 'logarithmic' },
            { value: 'golden', label: 'golden' },
        ], 'archimedean'),
        rangeControl('turns', 'Turns', 0.5, 30, 0.5, 6),
        rangeControl('samples', 'Samples', 30, 1200, 10, 400),
        rangeControl('radius', 'Radius', 0.1, 1.2, 0.01, 0.85),
        rangeControl('tightness', 'Tightness', 0.05, 0.6, 0.01, 0.22),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 30, 0.2, 3),
        rangeControl('copies', 'Copies', 1, 12, 1, 1),
        colorControl('colorA', 'Color A', '#f8fafc'),
        colorControl('colorB', 'Color B', '#0ea5e9'),
    ],
    render: ({ width, height, n, s }) => {
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = (Math.min(width, height) / 2) * n('radius');
        const samples = Math.round(n('samples'));
        const copies = Math.round(n('copies'));
        const type = s('type');
        const radiusAt = (t) => {
            if (type === 'logarithmic') {
                return maxRadius * ((Math.exp(t * (1 / n('tightness'))) - 1) / (Math.exp(1 / n('tightness')) - 1));
            }
            if (type === 'golden') {
                const growth = 1.61803398875;
                return maxRadius * ((growth ** (t * n('turns')) - 1) / (growth ** n('turns') - 1));
            }
            return maxRadius * t;
        };
        return times(copies, (copy) => {
            const rotation = (copy / copies) * 360;
            const points = times(samples + 1, (index) => {
                const t = index / samples;
                return polar(cx, cy, radiusAt(t), rotation + t * n('turns') * 360);
            });
            return `<path d="${polyline(points)}" fill="none" stroke="${mixColors(s('colorA'), s('colorB'), copies === 1 ? 0.5 : copy / (copies - 1))}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" />`;
        }).join('\n');
    },
};
export const ssscribble = {
    controls: [
        rangeControl('paths', 'Scribbles', 1, 40, 1, 4),
        rangeControl('steps', 'Steps per scribble', 5, 400, 5, 90),
        rangeControl('stepSize', 'Step size', 2, 120, 1, 34),
        rangeControl('turnAmount', 'Turn amount', 0, 180, 1, 62),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 20, 0.2, 3),
        rangeControl('margin', 'Margin', 0, 0.4, 0.01, 0.08),
        rangeControl('smoothing', 'Smoothing', 0, 1.5, 0.05, 1),
        colorControl('colorA', 'Color A', '#f8fafc'),
        colorControl('colorB', 'Color B', '#f43f5e'),
    ],
    render: ({ width, height, random, n, s }) => {
        const paths = Math.round(n('paths'));
        const steps = Math.round(n('steps'));
        const margin = Math.min(width, height) * n('margin');
        return times(paths, (index) => {
            let x = margin + random() * (width - margin * 2);
            let y = margin + random() * (height - margin * 2);
            let heading = random() * 360;
            const points = [{ x, y }];
            for (let step = 0; step < steps; step += 1) {
                heading += (random() - 0.5) * n('turnAmount');
                const next = polar(x, y, n('stepSize'), heading);
                x = Math.max(margin, Math.min(width - margin, next.x));
                y = Math.max(margin, Math.min(height - margin, next.y));
                if (x <= margin || x >= width - margin || y <= margin || y >= height - margin) {
                    heading += 120 + random() * 120;
                }
                points.push({ x, y });
            }
            return `<path d="${smoothPath(points, false, n('smoothing'))}" fill="none" stroke="${mixColors(s('colorA'), s('colorB'), paths === 1 ? 0.5 : index / (paths - 1))}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" stroke-linejoin="round" />`;
        }).join('\n');
    },
};
export const sssquiggly = {
    controls: [
        rangeControl('lines', 'Lines', 1, 80, 1, 18),
        rangeControl('amplitude', 'Amplitude', 0, 120, 1, 18),
        rangeControl('frequency', 'Frequency', 0.5, 24, 0.5, 8),
        rangeControl('jitter', 'Jitter', 0, 80, 1, 14),
        rangeControl('samples', 'Samples', 8, 200, 1, 70),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 16, 0.2, 3),
        rangeControl('padding', 'Padding', 0, 0.3, 0.01, 0.06),
        rangeControl('phaseShift', 'Phase shift', 0, 3, 0.05, 0.8),
        colorControl('colorA', 'Color A', '#34d399'),
        colorControl('colorB', 'Color B', '#6366f1'),
        toggleControl('vertical', 'Vertical lines', false),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const lines = Math.round(n('lines'));
        const vertical = b('vertical');
        const along = vertical ? height : width;
        const across = vertical ? width : height;
        const padding = across * n('padding');
        const step = (across - padding * 2) / Math.max(1, lines - 1);
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), lines);
        return times(lines, (index) => {
            const points = wavePoints({
                width: along,
                baseline: lines === 1 ? across / 2 : padding + step * index,
                amplitude: n('amplitude'),
                frequency: n('frequency'),
                phase: index * n('phaseShift'),
                samples: Math.round(n('samples')),
                jitter: n('jitter'),
                random,
            });
            const mapped = vertical ? points.map((p) => ({ x: p.y, y: p.x })) : points;
            return `<path d="${smoothPath(mapped, false)}" fill="none" stroke="${colors[index]}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" />`;
        }).join('\n');
    },
};
