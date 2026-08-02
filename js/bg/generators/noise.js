import { colorControl, rangeControl, selectControl, toggleControl } from '../lib/controls.js';
import { mixColors } from '../lib/color.js';
import { blobPoints, polar, polyline, regularPolygon, round, smoothPath } from '../lib/geometry.js';
import { blurFilter, defs, displaceFilter, grainFilter, linearGradient, radialGradient, stopsFromColors, } from '../lib/filters.js';
import { times } from '../lib/random.js';
export const nnnoise = {
    controls: [
        rangeControl('frequency', 'Noise frequency', 0.05, 3, 0.05, 0.65),
        rangeControl('octaves', 'Octaves', 1, 8, 1, 4),
        rangeControl('opacity', 'Noise opacity', 0.02, 1, 0.01, 0.7),
        rangeControl('contrast', 'Contrast', 0.2, 3, 0.05, 1.2),
        rangeControl('angle', 'Base gradient angle', 0, 360, 1, 45),
        selectControl('blend', 'Blend mode', [
            { value: 'normal', label: 'normal' },
            { value: 'overlay', label: 'overlay' },
            { value: 'multiply', label: 'multiply' },
            { value: 'screen', label: 'screen' },
            { value: 'soft-light', label: 'soft light' },
        ], 'overlay'),
        colorControl('colorA', 'Color A', '#111827'),
        colorControl('colorB', 'Color B', '#6366f1'),
        toggleControl('monochrome', 'Monochrome noise', true),
        toggleControl('baseGradient', 'Base gradient', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const base = b('baseGradient')
            ? `<rect width="${width}" height="${height}" fill="url(#nnnoise-base)" />`
            : '';
        return `${defs(linearGradient('nnnoise-base', stopsFromColors([s('colorA'), s('colorB')]), n('angle')), grainFilter('nnnoise-grain', {
            frequency: n('frequency'),
            octaves: n('octaves'),
            monochrome: b('monochrome'),
            seed: Math.floor(random() * 1000),
        }))}
${base}
<rect width="${width}" height="${height}" filter="url(#nnnoise-grain)" opacity="${round(Math.min(1, n('opacity') * n('contrast')), 3)}" style="mix-blend-mode:${s('blend')}" />`;
    },
};
export const gggrain = {
    controls: [
        rangeControl('blobs', 'Gradient blobs', 1, 12, 1, 4),
        rangeControl('blobSize', 'Blob size', 0.1, 1.2, 0.01, 0.6),
        rangeControl('blur', 'Blob blur', 0, 220, 1, 80),
        rangeControl('frequency', 'Grain frequency', 0.1, 4, 0.05, 1.2),
        rangeControl('octaves', 'Grain octaves', 1, 6, 1, 3),
        rangeControl('grainOpacity', 'Grain opacity', 0, 1, 0.01, 0.42),
        colorControl('colorA', 'Color A', '#f97316'),
        colorControl('colorB', 'Color B', '#7c3aed'),
        colorControl('colorC', 'Color C', '#0f172a'),
        toggleControl('vignette', 'Vignette', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const palette = [s('colorA'), s('colorB'), s('colorC')];
        const count = Math.round(n('blobs'));
        const minSide = Math.min(width, height);
        const blobs = times(count, (index) => {
            const cx = random() * width;
            const cy = random() * height;
            const radius = minSide * n('blobSize') * (0.5 + random() * 0.7);
            return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="${palette[index % palette.length]}" />`;
        }).join('\n');
        const vignette = b('vignette')
            ? `<rect width="${width}" height="${height}" fill="url(#gggrain-vignette)" />`
            : '';
        return `${defs(blurFilter('gggrain-blur', Math.max(0.01, n('blur'))), radialGradient('gggrain-vignette', [
            { offset: 0.4, color: s('colorC'), opacity: 0 },
            { offset: 1, color: s('colorC'), opacity: 0.75 },
        ], 0.5, 0.5, 0.85), grainFilter('gggrain-grain', {
            frequency: n('frequency'),
            octaves: n('octaves'),
            monochrome: true,
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#gggrain-blur)">
${blobs}
</g>
${vignette}
<rect width="${width}" height="${height}" filter="url(#gggrain-grain)" opacity="${round(n('grainOpacity'), 3)}" style="mix-blend-mode:overlay" />`;
    },
};
export const ggglitch = {
    controls: [
        rangeControl('slices', 'Slices', 2, 120, 1, 26),
        rangeControl('offset', 'Max slice offset', 0, 300, 1, 60),
        rangeControl('offsetChance', 'Glitch chance', 0, 1, 0.01, 0.5),
        rangeControl('channelOffset', 'Channel offset', 0, 60, 1, 12),
        rangeControl('bars', 'Scan bars', 0, 60, 1, 8),
        rangeControl('barOpacity', 'Scan bar opacity', 0, 1, 0.01, 0.15),
        rangeControl('angle', 'Gradient angle', 0, 360, 1, 90),
        colorControl('colorA', 'Color A', '#22d3ee'),
        colorControl('colorB', 'Color B', '#f43f5e'),
        toggleControl('vertical', 'Vertical slices', false),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const slices = Math.round(n('slices'));
        const vertical = b('vertical');
        const sliceSize = (vertical ? width : height) / slices;
        const buildSlices = (fill, shiftBias, onlyGlitched = false) => times(slices, (index) => {
            const glitched = random() < n('offsetChance');
            if (onlyGlitched && !glitched) {
                return '';
            }
            const shift = glitched ? (random() - 0.5) * n('offset') * 2 + shiftBias : shiftBias;
            const x = vertical ? index * sliceSize : 0;
            const y = vertical ? 0 : index * sliceSize;
            const w = vertical ? sliceSize : width;
            const h = vertical ? height : sliceSize;
            const tx = vertical ? 0 : shift;
            const ty = vertical ? shift : 0;
            return `<rect x="${round(x + tx)}" y="${round(y + ty)}" width="${round(w)}" height="${round(h)}" fill="${fill}" />`;
        })
            .filter(Boolean)
            .join('\n');
        const channels = [
            { fill: '#ff2d55', shift: -n('channelOffset') },
            { fill: '#00d5ff', shift: n('channelOffset') },
        ]
            .map((channel) => `<g style="mix-blend-mode:screen" opacity="0.5">\n${buildSlices(channel.fill, channel.shift, true)}\n</g>`)
            .join('\n');
        const bars = times(Math.round(n('bars')), () => {
            const y = random() * height;
            const h = 1 + random() * 8;
            return `<rect x="0" y="${round(y)}" width="${width}" height="${round(h)}" fill="#ffffff" opacity="${round(n('barOpacity'), 3)}" />`;
        }).join('\n');
        return `${defs(linearGradient('ggglitch-base', stopsFromColors([s('colorA'), s('colorB')]), n('angle'), {
            width,
            height,
        }))}
<g>
${buildSlices('url(#ggglitch-base)', 0)}
</g>
${channels}
${bars}`;
    },
};
export const ccchaos = {
    controls: [
        rangeControl('shapes', 'Shapes', 3, 400, 1, 70),
        rangeControl('size', 'Max size', 4, 260, 1, 70),
        rangeControl('sizeVariation', 'Size variation', 0, 1, 0.01, 0.7),
        rangeControl('turbulence', 'Turbulence', 0, 250, 1, 70),
        rangeControl('detail', 'Turbulence detail', 0.002, 0.08, 0.002, 0.02),
        rangeControl('strokeWidth', 'Stroke width', 0, 20, 0.5, 2),
        rangeControl('opacity', 'Opacity', 0.05, 1, 0.05, 0.8),
        selectControl('shape', 'Shape mix', [
            { value: 'mixed', label: 'mixed' },
            { value: 'circle', label: 'circles' },
            { value: 'polygon', label: 'polygons' },
            { value: 'blob', label: 'blobs' },
            { value: 'line', label: 'lines' },
        ], 'mixed'),
        colorControl('colorA', 'Color A', '#f43f5e'),
        colorControl('colorB', 'Color B', '#facc15'),
        toggleControl('filled', 'Filled shapes', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('shapes'));
        const kinds = ['circle', 'polygon', 'blob', 'line'];
        const shapes = times(count, () => {
            const cx = random() * width;
            const cy = random() * height;
            const size = n('size') * (1 - n('sizeVariation') * random());
            const color = mixColors(s('colorA'), s('colorB'), random());
            const paint = b('filled')
                ? `fill="${color}" opacity="${round(n('opacity'), 3)}"`
                : `fill="none" stroke="${color}" stroke-width="${round(Math.max(0.2, n('strokeWidth')))}" opacity="${round(n('opacity'), 3)}"`;
            const kind = s('shape') === 'mixed' ? kinds[Math.floor(random() * kinds.length)] : s('shape');
            if (kind === 'circle') {
                return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(size / 2)}" ${paint} />`;
            }
            if (kind === 'polygon') {
                const points = regularPolygon(cx, cy, size / 2, 3 + Math.floor(random() * 5), random() * 360);
                return `<path d="${polyline(points, true)}" ${paint} />`;
            }
            if (kind === 'blob') {
                const points = blobPoints({
                    cx,
                    cy,
                    radius: size / 2,
                    lobes: 6 + Math.floor(random() * 5),
                    irregularity: 0.7,
                    random,
                });
                return `<path d="${smoothPath(points)}" ${paint} />`;
            }
            const end = polar(cx, cy, size, random() * 360);
            return `<path d="M${round(cx)} ${round(cy)} L${round(end.x)} ${round(end.y)}" fill="none" stroke="${color}" stroke-width="${round(Math.max(0.2, n('strokeWidth')))}" stroke-linecap="round" opacity="${round(n('opacity'), 3)}" />`;
        }).join('\n');
        return `${defs(displaceFilter('ccchaos-turb', {
            frequency: n('detail'),
            octaves: 3,
            scale: n('turbulence'),
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#ccchaos-turb)">
${shapes}
</g>`;
    },
};
