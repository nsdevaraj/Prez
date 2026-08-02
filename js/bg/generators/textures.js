import { colorControl, rangeControl, selectControl, toggleControl } from '../lib/controls.js';
import { hslToHex, mixColors } from '../lib/color.js';
import { blobPoints, round, smoothPath } from '../lib/geometry.js';
import { blurFilter, defs, displaceFilter, grainFilter, linearGradient, radialGradient, } from '../lib/filters.js';
import { times } from '../lib/random.js';
export const wwwatercolor = {
    controls: [
        rangeControl('blotches', 'Blotches', 1, 40, 1, 9),
        rangeControl('layersPerBlotch', 'Layers per blotch', 1, 8, 1, 4),
        rangeControl('size', 'Size', 0.05, 0.8, 0.01, 0.28),
        rangeControl('bleed', 'Bleed', 0, 160, 1, 55),
        rangeControl('detail', 'Bleed detail', 0.002, 0.06, 0.002, 0.014),
        rangeControl('softness', 'Softness', 0, 30, 0.5, 3),
        rangeControl('opacity', 'Layer opacity', 0.02, 0.6, 0.01, 0.16),
        colorControl('colorA', 'Color A', '#2563eb'),
        colorControl('colorB', 'Color B', '#db2777'),
        toggleControl('spread', 'Spread across canvas', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const blotches = Math.round(n('blotches'));
        const layers = Math.round(n('layersPerBlotch'));
        const minSide = Math.min(width, height);
        const groups = times(blotches, () => {
            const cx = b('spread') ? random() * width : width / 2 + (random() - 0.5) * width * 0.3;
            const cy = b('spread') ? random() * height : height / 2 + (random() - 0.5) * height * 0.3;
            const baseRadius = minSide * n('size') * (0.5 + random() * 0.9);
            const color = mixColors(s('colorA'), s('colorB'), random());
            const shapes = times(layers, (layerIndex) => {
                const points = blobPoints({
                    cx: cx + (random() - 0.5) * baseRadius * 0.3,
                    cy: cy + (random() - 0.5) * baseRadius * 0.3,
                    radius: baseRadius * (1 - layerIndex * (0.5 / layers)),
                    lobes: 9 + Math.floor(random() * 7),
                    irregularity: 0.6,
                    random,
                });
                return `<path d="${smoothPath(points)}" fill="${color}" opacity="${round(n('opacity'), 3)}" />`;
            }).join('\n');
            return `<g>\n${shapes}\n</g>`;
        }).join('\n');
        return `${defs(displaceFilter('wwwatercolor-bleed', {
            frequency: n('detail'),
            octaves: 4,
            scale: n('bleed'),
            seed: Math.floor(random() * 1000),
        }), blurFilter('wwwatercolor-soft', Math.max(0.01, n('softness'))))}
<g filter="url(#wwwatercolor-bleed)">
<g filter="url(#wwwatercolor-soft)">
${groups}
</g>
</g>`;
    },
};
export const hhholographic = {
    controls: [
        rangeControl('bands', 'Bands', 2, 40, 1, 12),
        rangeControl('angle', 'Angle', 0, 360, 1, 35),
        rangeControl('hueStart', 'Hue start', 0, 360, 1, 190),
        rangeControl('hueSweep', 'Hue sweep', -720, 720, 5, 300),
        rangeControl('saturation', 'Saturation', 0, 1, 0.01, 0.75),
        rangeControl('lightness', 'Lightness', 0.1, 0.9, 0.01, 0.62),
        rangeControl('softness', 'Softness', 0, 120, 1, 32),
        rangeControl('warp', 'Warp', 0, 200, 1, 60),
        rangeControl('grain', 'Grain', 0, 1, 0.01, 0.2),
        toggleControl('sheen', 'Highlight sheen', true),
    ],
    render: ({ width, height, random, n, b }) => {
        const bands = Math.round(n('bands'));
        const colors = times(bands, (index) => hslToHex(n('hueStart') + (index / Math.max(1, bands - 1)) * n('hueSweep'), n('saturation'), n('lightness')));
        const stops = colors.map((color, index) => ({
            offset: index / Math.max(1, bands - 1),
            color,
        }));
        const sheen = b('sheen')
            ? `<rect width="${width}" height="${height}" fill="url(#hhholographic-sheen)" style="mix-blend-mode:screen" />`
            : '';
        const grain = n('grain') > 0
            ? `<rect width="${width}" height="${height}" filter="url(#hhholographic-grain)" opacity="${round(n('grain'), 3)}" style="mix-blend-mode:overlay" />`
            : '';
        return `${defs(linearGradient('hhholographic-base', stops, n('angle')), linearGradient('hhholographic-sheen', [
            { offset: 0, color: '#ffffff', opacity: 0 },
            { offset: 0.45, color: '#ffffff', opacity: 0.55 },
            { offset: 0.55, color: '#ffffff', opacity: 0.55 },
            { offset: 1, color: '#ffffff', opacity: 0 },
        ], n('angle') + 90), blurFilter('hhholographic-soft', Math.max(0.01, n('softness'))), displaceFilter('hhholographic-warp', {
            frequency: 0.006,
            octaves: 3,
            scale: n('warp'),
            seed: Math.floor(random() * 1000),
        }), grainFilter('hhholographic-grain', {
            frequency: 0.9,
            octaves: 3,
            monochrome: true,
            seed: Math.floor(random() * 1000),
        }))}
<g filter="url(#hhholographic-warp)">
<g filter="url(#hhholographic-soft)">
<rect x="${-width * 0.25}" y="${-height * 0.25}" width="${width * 1.5}" height="${height * 1.5}" fill="url(#hhholographic-base)" />
</g>
</g>
${sheen}
${grain}`;
    },
};
export const bbblurry = {
    controls: [
        rangeControl('blobs', 'Blobs', 1, 20, 1, 5),
        rangeControl('size', 'Blob size', 0.1, 1.2, 0.01, 0.5),
        rangeControl('blur', 'Blur', 0, 220, 1, 90),
        rangeControl('spread', 'Spread', 0, 1.2, 0.01, 0.7),
        rangeControl('opacity', 'Opacity', 0.1, 1, 0.05, 0.9),
        selectControl('shape', 'Shape', [
            { value: 'circle', label: 'circle' },
            { value: 'blob', label: 'blob' },
        ], 'circle'),
        colorControl('colorA', 'Color A', '#8b5cf6'),
        colorControl('colorB', 'Color B', '#f472b6'),
        colorControl('colorC', 'Color C', '#22d3ee'),
        toggleControl('glow', 'Radial glow center', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('blobs'));
        const minSide = Math.min(width, height);
        const palette = [s('colorA'), s('colorB'), s('colorC')];
        const shapes = times(count, (index) => {
            const cx = width / 2 + (random() - 0.5) * width * n('spread');
            const cy = height / 2 + (random() - 0.5) * height * n('spread');
            const radius = minSide * n('size') * (0.45 + random() * 0.8);
            const color = palette[index % palette.length];
            if (s('shape') === 'blob') {
                const points = blobPoints({
                    cx,
                    cy,
                    radius,
                    lobes: 8,
                    irregularity: 0.5,
                    random,
                });
                return `<path d="${smoothPath(points)}" fill="${color}" opacity="${round(n('opacity'), 3)}" />`;
            }
            return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="${color}" opacity="${round(n('opacity'), 3)}" />`;
        }).join('\n');
        const glow = b('glow')
            ? `<rect width="${width}" height="${height}" fill="url(#bbblurry-glow)" />`
            : '';
        return `${defs(blurFilter('bbblurry-blur', Math.max(0.01, n('blur'))), radialGradient('bbblurry-glow', [
            { offset: 0, color: s('colorA'), opacity: 0.35 },
            { offset: 1, color: s('colorC'), opacity: 0 },
        ]))}
<g filter="url(#bbblurry-blur)">
${shapes}
</g>
${glow}`;
    },
};
