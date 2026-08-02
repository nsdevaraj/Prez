import { colorControl, rangeControl, toggleControl } from '../lib/controls.js';
import { hslToHex, mixColors, tripleRamp, withAlpha } from '../lib/color.js';
import { blobPoints, round, smoothPath, wavePoints } from '../lib/geometry.js';
import { blurFilter, defs, displaceFilter, linearGradient, stopsFromColors } from '../lib/filters.js';
import { times } from '../lib/random.js';
export const aaabstract = {
    controls: [
        rangeControl('fields', 'Color fields', 2, 14, 1, 6),
        rangeControl('spread', 'Spread', 0.2, 1.4, 0.05, 0.85),
        rangeControl('softness', 'Softness', 0, 160, 1, 70),
        rangeControl('distortion', 'Distortion', 0, 220, 1, 90),
        rangeControl('detail', 'Distortion detail', 0.001, 0.03, 0.001, 0.006),
        rangeControl('octaves', 'Distortion octaves', 1, 5, 1, 3),
        colorControl('colorA', 'Color A', '#7c3aed'),
        colorControl('colorB', 'Color B', '#06b6d4'),
        colorControl('colorC', 'Color C', '#f472b6'),
        toggleControl('gradientBase', 'Gradient base layer', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('fields'));
        const colors = tripleRamp(s('colorA'), s('colorB'), s('colorC'), count);
        const shapes = times(count, (index) => {
            const cx = width * (0.12 + random() * 0.76);
            const cy = height * (0.12 + random() * 0.76);
            const radius = Math.min(width, height) * n('spread') * (0.28 + random() * 0.45);
            const points = blobPoints({
                cx,
                cy,
                radius,
                lobes: 7 + Math.floor(random() * 5),
                irregularity: 0.55,
                random,
                squash: 0.75 + random() * 0.5,
            });
            return `<path d="${smoothPath(points)}" fill="${colors[index]}" opacity="${round(0.55 + random() * 0.4, 3)}" />`;
        }).join('\n');
        const base = b('gradientBase')
            ? `<rect x="${-width * 0.2}" y="${-height * 0.2}" width="${width * 1.4}" height="${height * 1.4}" fill="url(#aaabstract-base)" />`
            : '';
        return `${defs(linearGradient('aaabstract-base', stopsFromColors([s('colorA'), s('colorC')]), 35), blurFilter('aaabstract-soft', Math.max(0.01, n('softness'))), displaceFilter('aaabstract-warp', {
            frequency: n('detail'),
            octaves: n('octaves'),
            scale: n('distortion'),
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#aaabstract-warp)">
${base}
<g filter="url(#aaabstract-soft)">
${shapes}
</g>
</g>`;
    },
};
export const pppsychedelic = {
    controls: [
        rangeControl('rings', 'Rings', 4, 80, 1, 28),
        rangeControl('thickness', 'Ring thickness', 1, 40, 0.5, 9),
        rangeControl('warp', 'Warp', 0, 140, 1, 55),
        rangeControl('detail', 'Warp detail', 0.001, 0.04, 0.001, 0.009),
        rangeControl('hueStart', 'Hue start', 0, 360, 1, 280),
        rangeControl('hueSweep', 'Hue sweep', -720, 720, 5, 320),
        rangeControl('saturation', 'Saturation', 0, 1, 0.01, 0.85),
        rangeControl('lightness', 'Lightness', 0.1, 0.9, 0.01, 0.55),
        rangeControl('centerX', 'Center X', 0, 1, 0.01, 0.5),
        rangeControl('centerY', 'Center Y', 0, 1, 0.01, 0.5),
    ],
    render: ({ width, height, random, n }) => {
        const rings = Math.round(n('rings'));
        const cx = width * n('centerX');
        const cy = height * n('centerY');
        const maxRadius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
        const circles = times(rings, (index) => {
            const t = rings === 1 ? 0 : index / (rings - 1);
            const radius = maxRadius * (1 - t) + n('thickness');
            const color = hslToHex(n('hueStart') + t * n('hueSweep'), n('saturation'), n('lightness'));
            return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="none" stroke="${color}" stroke-width="${round(n('thickness'))}" />`;
        }).join('\n');
        return `${defs(displaceFilter('pppsychedelic-warp', {
            frequency: n('detail'),
            octaves: 3,
            scale: n('warp'),
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#pppsychedelic-warp)">
${circles}
</g>`;
    },
};
export const rrreflection = {
    controls: [
        rangeControl('layers', 'Wave layers', 1, 14, 1, 5),
        rangeControl('amplitude', 'Amplitude', 0, 220, 1, 70),
        rangeControl('frequency', 'Frequency', 0.2, 6, 0.1, 1.4),
        rangeControl('samples', 'Smoothness', 6, 80, 1, 26),
        rangeControl('horizon', 'Horizon', 0.1, 0.9, 0.01, 0.5),
        rangeControl('gap', 'Reflection gap', 0, 120, 1, 12),
        rangeControl('reflectionFade', 'Reflection fade', 0, 1, 0.01, 0.6),
        rangeControl('ripple', 'Ripple', 0, 60, 1, 14),
        colorControl('colorA', 'Color A', '#0ea5e9'),
        colorControl('colorB', 'Color B', '#f59e0b'),
    ],
    render: ({ width, height, random, n, s }) => {
        const layers = Math.round(n('layers'));
        const horizon = height * n('horizon');
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), layers);
        const bands = times(layers, (index) => {
            const t = layers === 1 ? 0 : index / (layers - 1);
            const baseline = horizon - n('amplitude') * 0.6 - t * horizon * 0.6;
            const points = wavePoints({
                width,
                baseline,
                amplitude: n('amplitude') * (0.4 + t * 0.8),
                frequency: n('frequency') * (0.7 + t * 0.6),
                phase: random() * Math.PI * 2,
                samples: Math.round(n('samples')),
            });
            const top = smoothPath(points, false);
            const shape = `${top} L${round(width)} ${round(horizon)} L0 ${round(horizon)} Z`;
            return { shape, color: colors[index] };
        });
        const upper = bands
            .map((band) => `<path d="${band.shape}" fill="${band.color}" />`)
            .join('\n');
        const lower = bands
            .map((band, index) => `<path d="${band.shape}" fill="${band.color}" opacity="${round(1 - n('reflectionFade') * ((index + 1) / bands.length), 3)}" />`)
            .join('\n');
        return `${defs(displaceFilter('rrreflection-ripple', {
            frequency: 0.012,
            octaves: 2,
            scale: n('ripple'),
            seed: Math.floor(random() * 1000),
        }))}
<g>
${upper}
</g>
<g transform="translate(0 ${round(horizon * 2 + n('gap'))}) scale(1 -1)" filter="url(#rrreflection-ripple)">
${lower}
</g>`;
    },
};
export const ffflux = {
    controls: [
        rangeControl('layers', 'Layers', 1, 16, 1, 6),
        rangeControl('scale', 'Shape scale', 0.3, 1.6, 0.05, 0.95),
        rangeControl('irregularity', 'Irregularity', 0, 1.2, 0.05, 0.5),
        rangeControl('lobes', 'Lobes', 3, 18, 1, 8),
        rangeControl('drift', 'Drift', 0, 1, 0.01, 0.35),
        rangeControl('warp', 'Warp', 0, 120, 1, 26),
        rangeControl('opacity', 'Layer opacity', 0.1, 1, 0.01, 0.85),
        colorControl('colorA', 'Color A', '#312e81'),
        colorControl('colorB', 'Color B', '#22d3ee'),
        toggleControl('gradientFill', 'Gradient fill', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const layers = Math.round(n('layers'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), layers);
        const cxBase = width / 2;
        const cyBase = height / 2;
        const shapes = times(layers, (index) => {
            const t = layers === 1 ? 0 : index / (layers - 1);
            const drift = n('drift') * Math.min(width, height) * 0.5;
            const points = blobPoints({
                cx: cxBase + (random() - 0.5) * drift,
                cy: cyBase + (random() - 0.5) * drift,
                radius: Math.min(width, height) * n('scale') * (0.62 - t * 0.35),
                lobes: n('lobes'),
                irregularity: n('irregularity'),
                random,
            });
            const fill = b('gradientFill') ? `url(#ffflux-grad-${index})` : colors[index];
            return {
                markup: `<path d="${smoothPath(points)}" fill="${fill}" opacity="${round(n('opacity'), 3)}" />`,
                gradient: linearGradient(`ffflux-grad-${index}`, stopsFromColors([colors[index], mixColors(colors[index], s('colorB'), 0.55)]), 45 + index * 18),
            };
        });
        return `${defs(...shapes.map((shape) => shape.gradient), displaceFilter('ffflux-warp', {
            frequency: 0.008,
            octaves: 2,
            scale: n('warp'),
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#ffflux-warp)">
${shapes.map((shape) => shape.markup).join('\n')}
</g>`;
    },
};
export const sssurf = {
    controls: [
        rangeControl('layers', 'Wave layers', 2, 24, 1, 8),
        rangeControl('amplitude', 'Amplitude', 0, 200, 1, 55),
        rangeControl('frequency', 'Frequency', 0.2, 6, 0.1, 1.2),
        rangeControl('phaseShift', 'Phase shift', 0, 3, 0.05, 0.7),
        rangeControl('samples', 'Smoothness', 6, 90, 1, 28),
        rangeControl('start', 'Stack start', 0, 1, 0.01, 0.25),
        rangeControl('spacing', 'Stack spacing', 0.2, 1.5, 0.05, 0.9),
        colorControl('colorA', 'Color A', '#0f172a'),
        colorControl('colorB', 'Color B', '#38bdf8'),
        toggleControl('outline', 'Crest outline', false),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const layers = Math.round(n('layers'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.6), s('colorB'), layers);
        const startY = height * n('start');
        const step = ((height - startY) / layers) * n('spacing');
        return times(layers, (index) => {
            const baseline = startY + step * index;
            const points = wavePoints({
                width,
                baseline,
                amplitude: n('amplitude') * (0.35 + (index / layers) * 0.9),
                frequency: n('frequency'),
                phase: index * n('phaseShift') + random() * 0.4,
                samples: Math.round(n('samples')),
            });
            const path = `${smoothPath(points, false)} L${round(width)} ${round(height)} L0 ${round(height)} Z`;
            const stroke = b('outline')
                ? ` stroke="${withAlpha('#ffffff', 0.35)}" stroke-width="1.5"`
                : '';
            return `<path d="${path}" fill="${colors[index]}"${stroke} />`;
        }).join('\n');
    },
};
export const uuunion = {
    controls: [
        rangeControl('shapes', 'Shapes', 2, 24, 1, 8),
        rangeControl('size', 'Shape size', 0.05, 0.6, 0.01, 0.24),
        rangeControl('spread', 'Spread', 0.1, 1, 0.01, 0.55),
        rangeControl('irregularity', 'Irregularity', 0, 1, 0.05, 0.55),
        rangeControl('lobes', 'Lobes', 3, 16, 1, 9),
        rangeControl('outline', 'Outline width', 0, 24, 0.5, 0),
        colorControl('fill', 'Fill', '#f43f5e'),
        colorControl('outlineColor', 'Outline color', '#0f172a'),
        toggleControl('gradient', 'Gradient fill', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('shapes'));
        const minSide = Math.min(width, height);
        const paths = times(count, () => {
            const cx = width / 2 + (random() - 0.5) * width * n('spread');
            const cy = height / 2 + (random() - 0.5) * height * n('spread');
            const radius = minSide * n('size') * (0.6 + random() * 0.8);
            const points = blobPoints({
                cx,
                cy,
                radius,
                lobes: n('lobes'),
                irregularity: n('irregularity'),
                random,
            });
            return `<path d="${smoothPath(points)}" />`;
        }).join('\n');
        const stroke = n('outline') > 0
            ? ` stroke="${s('outlineColor')}" stroke-width="${round(n('outline'))}" stroke-linejoin="round"`
            : '';
        return `${defs(linearGradient('uuunion-grad', stopsFromColors([s('fill'), mixColors(s('fill'), s('outlineColor'), 0.45)]), 60))}
<g fill="${b('gradient') ? 'url(#uuunion-grad)' : s('fill')}"${stroke}>
${paths}
</g>`;
    },
};
export const uuundulate = {
    controls: [
        rangeControl('lines', 'Lines', 2, 90, 1, 26),
        rangeControl('amplitude', 'Amplitude', 0, 180, 1, 45),
        rangeControl('frequency', 'Frequency', 0.2, 8, 0.1, 1.6),
        rangeControl('phaseShift', 'Phase shift', 0, 2, 0.02, 0.24),
        rangeControl('amplitudeCurve', 'Amplitude curve', 0, 2, 0.05, 1),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 16, 0.2, 2),
        rangeControl('samples', 'Smoothness', 6, 120, 1, 40),
        rangeControl('padding', 'Padding', 0, 0.4, 0.01, 0.08),
        colorControl('colorA', 'Color A', '#a855f7'),
        colorControl('colorB', 'Color B', '#f8fafc'),
    ],
    render: ({ width, height, n, s }) => {
        const lines = Math.round(n('lines'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), lines);
        const padding = height * n('padding');
        const usable = height - padding * 2;
        return times(lines, (index) => {
            const t = lines === 1 ? 0.5 : index / (lines - 1);
            const envelope = Math.sin(Math.PI * t) ** Math.max(0.001, n('amplitudeCurve'));
            const points = wavePoints({
                width,
                baseline: padding + usable * t,
                amplitude: n('amplitude') * envelope,
                frequency: n('frequency'),
                phase: index * n('phaseShift'),
                samples: Math.round(n('samples')),
            });
            return `<path d="${smoothPath(points, false)}" fill="none" stroke="${colors[index]}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" />`;
        }).join('\n');
    },
};
