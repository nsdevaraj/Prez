import { colorControl, rangeControl, selectControl, toggleControl } from '../lib/controls.js';
import { mixColors } from '../lib/color.js';
import { polar, round } from '../lib/geometry.js';
import { times } from '../lib/random.js';
const gradientDirections = [
    { value: 'none', label: 'uniform' },
    { value: 'top', label: 'top to bottom' },
    { value: 'bottom', label: 'bottom to top' },
    { value: 'left', label: 'left to right' },
    { value: 'right', label: 'right to left' },
    { value: 'center', label: 'center out' },
    { value: 'edges', label: 'edges in' },
];
function gradientFactor(direction, x, y, width, height) {
    const nx = x / width;
    const ny = y / height;
    switch (direction) {
        case 'top':
            return 1 - ny;
        case 'bottom':
            return ny;
        case 'left':
            return 1 - nx;
        case 'right':
            return nx;
        case 'center':
            return 1 - Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2);
        case 'edges':
            return Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2);
        default:
            return 1;
    }
}
export const ssspot = {
    controls: [
        rangeControl('count', 'Spots', 5, 3000, 5, 500),
        rangeControl('minSize', 'Min size', 0.2, 40, 0.2, 1.5),
        rangeControl('maxSize', 'Max size', 0.5, 80, 0.5, 9),
        selectControl('gradient', 'Size gradient', gradientDirections, 'top'),
        rangeControl('gradientPower', 'Gradient power', 0.2, 4, 0.1, 1.4),
        rangeControl('opacity', 'Opacity', 0.05, 1, 0.05, 1),
        rangeControl('margin', 'Margin', 0, 0.3, 0.01, 0.02),
        colorControl('colorA', 'Color A', '#f8fafc'),
        colorControl('colorB', 'Color B', '#8b5cf6'),
        toggleControl('colorByGradient', 'Color follows gradient', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('count'));
        const margin = Math.min(width, height) * n('margin');
        const direction = s('gradient');
        const minSize = Math.min(n('minSize'), n('maxSize'));
        const maxSize = Math.max(n('minSize'), n('maxSize'));
        return times(count, () => {
            const x = margin + random() * (width - margin * 2);
            const y = margin + random() * (height - margin * 2);
            const factor = gradientFactor(direction, x, y, width, height) ** n('gradientPower');
            const radius = minSize + (maxSize - minSize) * factor * random();
            const color = b('colorByGradient')
                ? mixColors(s('colorA'), s('colorB'), factor)
                : mixColors(s('colorA'), s('colorB'), random());
            return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${color}"${n('opacity') < 1 ? ` opacity="${round(n('opacity'), 3)}"` : ''} />`;
        }).join('\n');
    },
};
export const ffflurry = {
    controls: [
        rangeControl('count', 'Marks', 5, 1200, 5, 420),
        rangeControl('length', 'Mark length', 2, 160, 1, 26),
        rangeControl('lengthVariation', 'Length variation', 0, 1, 0.01, 0.6),
        rangeControl('strokeWidth', 'Stroke width', 0.2, 20, 0.2, 2.5),
        rangeControl('flowScale', 'Flow scale', 0.2, 8, 0.1, 1.6),
        rangeControl('chaos', 'Chaos', 0, 180, 1, 25),
        selectControl('gradient', 'Density gradient', gradientDirections, 'center'),
        rangeControl('margin', 'Margin', 0, 0.3, 0.01, 0.03),
        colorControl('colorA', 'Color A', '#fbbf24'),
        colorControl('colorB', 'Color B', '#db2777'),
        toggleControl('roundCaps', 'Round caps', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('count'));
        const margin = Math.min(width, height) * n('margin');
        const cap = b('roundCaps') ? 'round' : 'butt';
        return times(count, () => {
            const x = margin + random() * (width - margin * 2);
            const y = margin + random() * (height - margin * 2);
            const factor = gradientFactor(s('gradient'), x, y, width, height);
            if (random() > factor * 0.9 + 0.1) {
                return '';
            }
            const flow = Math.sin((x / width) * Math.PI * n('flowScale')) * 180 +
                Math.cos((y / height) * Math.PI * n('flowScale')) * 180;
            const angle = flow + (random() - 0.5) * n('chaos') * 2;
            const length = n('length') * (1 - n('lengthVariation') * random());
            const end = polar(x, y, length, angle);
            return `<path d="M${round(x)} ${round(y)} L${round(end.x)} ${round(end.y)}" stroke="${mixColors(s('colorA'), s('colorB'), factor)}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="${cap}" fill="none" />`;
        })
            .filter(Boolean)
            .join('\n');
    },
};
export const llleaves = {
    controls: [
        rangeControl('count', 'Leaves', 3, 600, 1, 90),
        rangeControl('size', 'Leaf size', 4, 200, 1, 46),
        rangeControl('sizeVariation', 'Size variation', 0, 1, 0.01, 0.5),
        rangeControl('width', 'Leaf width', 0.1, 1.4, 0.01, 0.55),
        rangeControl('rotationSpread', 'Rotation spread', 0, 360, 5, 360),
        rangeControl('strokeWidth', 'Vein width', 0, 8, 0.2, 1),
        rangeControl('margin', 'Margin', 0, 0.3, 0.01, 0.05),
        colorControl('colorA', 'Color A', '#16a34a'),
        colorControl('colorB', 'Color B', '#065f46'),
        colorControl('vein', 'Vein color', '#ecfdf5'),
        toggleControl('veins', 'Draw veins', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('count'));
        const margin = Math.min(width, height) * n('margin');
        return times(count, () => {
            const cx = margin + random() * (width - margin * 2);
            const cy = margin + random() * (height - margin * 2);
            const length = n('size') * (1 - n('sizeVariation') * random());
            const half = length / 2;
            const bulge = half * n('width');
            const rotation = (random() - 0.5) * n('rotationSpread');
            const color = mixColors(s('colorA'), s('colorB'), random());
            const leaf = `<path d="M0 ${round(-half)} C${round(bulge)} ${round(-half * 0.2)}, ${round(bulge)} ${round(half * 0.2)}, 0 ${round(half)} C${round(-bulge)} ${round(half * 0.2)}, ${round(-bulge)} ${round(-half * 0.2)}, 0 ${round(-half)} Z" fill="${color}" />`;
            const vein = b('veins')
                ? `<path d="M0 ${round(-half * 0.85)} L0 ${round(half * 0.85)}" stroke="${s('vein')}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round" fill="none" opacity="0.75" />`
                : '';
            return `<g transform="translate(${round(cx)} ${round(cy)}) rotate(${round(rotation)})">${leaf}${vein}</g>`;
        }).join('\n');
    },
};
