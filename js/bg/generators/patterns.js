import { colorControl, rangeControl, selectControl, toggleControl } from '../lib/controls.js';
import { mixColors, tripleRamp } from '../lib/color.js';
import { polar, polyline, regularPolygon, round, smoothPath, starPoints } from '../lib/geometry.js';
import { times } from '../lib/random.js';
const motifShapes = ['circle', 'square', 'triangle', 'cross', 'diamond', 'ring'];
function shapeMarkup(shape, size, strokeWidth) {
    const half = size / 2;
    switch (shape) {
        case 'square':
            return `<rect x="${round(-half)}" y="${round(-half)}" width="${round(size)}" height="${round(size)}" />`;
        case 'triangle':
            return `<path d="${polyline(regularPolygon(0, 0, half, 3), true)}" />`;
        case 'cross':
            return `<path d="M${round(-half)} 0 H${round(half)} M0 ${round(-half)} V${round(half)}" fill="none" stroke-width="${round(strokeWidth)}" stroke-linecap="round" />`;
        case 'diamond':
            return `<path d="${polyline(regularPolygon(0, 0, half, 4, 0), true)}" />`;
        case 'ring':
            return `<circle cx="0" cy="0" r="${round(half)}" fill="none" stroke-width="${round(strokeWidth)}" />`;
        default:
            return `<circle cx="0" cy="0" r="${round(half)}" />`;
    }
}
export const rrrepeat = {
    controls: [
        selectControl('shape', 'Shape', [...motifShapes], 'circle'),
        rangeControl('tile', 'Tile size', 8, 200, 1, 48),
        rangeControl('size', 'Shape size', 2, 200, 1, 22),
        rangeControl('rotation', 'Rotation', 0, 360, 1, 0),
        rangeControl('offset', 'Row offset', 0, 1, 0.01, 0.5),
        rangeControl('strokeWidth', 'Stroke width', 0.5, 20, 0.5, 3),
        rangeControl('jitter', 'Jitter', 0, 40, 1, 0),
        colorControl('colorA', 'Color A', '#f472b6'),
        colorControl('colorB', 'Color B', '#38bdf8'),
        toggleControl('alternate', 'Alternate colors', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const tile = Math.max(4, n('tile'));
        const cols = Math.ceil(width / tile) + 2;
        const rows = Math.ceil(height / tile) + 2;
        const shape = shapeMarkup(s('shape'), n('size'), n('strokeWidth'));
        const cells = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const offset = row % 2 === 1 ? tile * n('offset') : 0;
                const x = col * tile + offset - tile / 2;
                const y = row * tile - tile / 2;
                const jx = (random() - 0.5) * n('jitter');
                const jy = (random() - 0.5) * n('jitter');
                const color = b('alternate') && (row + col) % 2 === 1 ? s('colorB') : s('colorA');
                cells.push(`<g transform="translate(${round(x + jx)} ${round(y + jy)}) rotate(${round(n('rotation'))})" fill="${color}" stroke="${color}">${shape}</g>`);
            }
        }
        return cells.join('\n');
    },
};
export const mmmotif = {
    controls: [
        rangeControl('columns', 'Columns', 1, 30, 1, 7),
        rangeControl('rows', 'Rows', 1, 30, 1, 7),
        rangeControl('arcs', 'Arcs per motif', 1, 10, 1, 4),
        rangeControl('scale', 'Motif scale', 0.2, 1.4, 0.05, 0.8),
        rangeControl('strokeWidth', 'Stroke width', 0.5, 24, 0.5, 4),
        rangeControl('rotationStep', 'Rotation step', 0, 180, 5, 90),
        colorControl('colorA', 'Color A', '#facc15'),
        colorControl('colorB', 'Color B', '#ef4444'),
        toggleControl('randomRotation', 'Random rotation', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const columns = Math.round(n('columns'));
        const rows = Math.round(n('rows'));
        const cellW = width / columns;
        const cellH = height / rows;
        const radius = (Math.min(cellW, cellH) / 2) * n('scale');
        const arcs = Math.round(n('arcs'));
        const cells = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < columns; col += 1) {
                const cx = cellW * (col + 0.5);
                const cy = cellH * (row + 0.5);
                const rotation = b('randomRotation')
                    ? Math.floor(random() * 4) * n('rotationStep')
                    : (row + col) * n('rotationStep');
                const color = mixColors(s('colorA'), s('colorB'), (row + col) / (rows + columns));
                const strokes = times(arcs, (index) => {
                    const r = (radius * (index + 1)) / arcs;
                    return `<path d="M${round(-r)} 0 A${round(r)} ${round(r)} 0 0 1 0 ${round(-r)}" />`;
                }).join('');
                cells.push(`<g transform="translate(${round(cx)} ${round(cy)}) rotate(${round(rotation)})" fill="none" stroke="${color}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="round">${strokes}</g>`);
            }
        }
        return cells.join('\n');
    },
};
export const rrreplicate = {
    controls: [
        rangeControl('copies', 'Copies', 2, 120, 1, 40),
        selectControl('shape', 'Shape', [...motifShapes], 'square'),
        rangeControl('size', 'Base size', 4, 400, 1, 220),
        rangeControl('scaleStep', 'Scale step', 0.8, 1.15, 0.005, 0.97),
        rangeControl('rotationStep', 'Rotation step', -45, 45, 0.5, 9),
        rangeControl('translateX', 'Shift X', -40, 40, 0.5, 2),
        rangeControl('translateY', 'Shift Y', -40, 40, 0.5, 1),
        rangeControl('strokeWidth', 'Stroke width', 0.5, 20, 0.5, 2),
        colorControl('colorA', 'Color A', '#22d3ee'),
        colorControl('colorB', 'Color B', '#a855f7'),
        toggleControl('filled', 'Filled shapes', false),
    ],
    render: ({ width, height, n, s, b }) => {
        const copies = Math.round(n('copies'));
        const colors = tripleRamp(s('colorA'), mixColors(s('colorA'), s('colorB'), 0.5), s('colorB'), copies);
        let x = width / 2;
        let y = height / 2;
        let scale = 1;
        let rotation = 0;
        return times(copies, (index) => {
            const markup = shapeMarkup(s('shape'), n('size'), n('strokeWidth') / Math.max(scale, 0.05));
            const color = colors[index];
            const paint = b('filled')
                ? `fill="${color}" stroke="none"`
                : `fill="none" stroke="${color}" stroke-width="${round(n('strokeWidth') / Math.max(scale, 0.05))}"`;
            const group = `<g transform="translate(${round(x)} ${round(y)}) rotate(${round(rotation)}) scale(${round(scale, 4)})" ${paint}>${markup}</g>`;
            x += n('translateX');
            y += n('translateY');
            rotation += n('rotationStep');
            scale *= n('scaleStep');
            return group;
        }).join('\n');
    },
};
export const ssscales = {
    controls: [
        rangeControl('columns', 'Columns', 2, 40, 1, 10),
        rangeControl('rowOverlap', 'Row overlap', 0.2, 1, 0.01, 0.55),
        rangeControl('strokeWidth', 'Stroke width', 0, 16, 0.5, 2),
        rangeControl('depth', 'Scale depth', 0.4, 1.6, 0.05, 1),
        colorControl('colorA', 'Color A', '#0ea5e9'),
        colorControl('colorB', 'Color B', '#1e1b4b'),
        colorControl('stroke', 'Stroke color', '#f8fafc'),
        toggleControl('flip', 'Flip scales', false),
    ],
    render: ({ width, height, n, s, b }) => {
        const columns = Math.round(n('columns'));
        const cell = width / columns;
        const radius = (cell / 2) * n('depth');
        const rowStep = cell * n('rowOverlap');
        const rows = Math.ceil(height / rowStep) + 2;
        const scales = [];
        for (let row = 0; row < rows; row += 1) {
            const t = rows === 1 ? 0 : row / (rows - 1);
            const color = mixColors(s('colorA'), s('colorB'), t);
            for (let col = 0; col <= columns; col += 1) {
                const offset = row % 2 === 1 ? cell / 2 : 0;
                const cx = col * cell + offset;
                const cy = row * rowStep;
                const sweep = b('flip') ? 0 : 1;
                const path = `M${round(cx - radius)} ${round(cy)} A${round(radius)} ${round(radius)} 0 0 ${sweep} ${round(cx + radius)} ${round(cy)}`;
                scales.push(`<path d="${path}" fill="${color}" stroke="${s('stroke')}" stroke-width="${round(n('strokeWidth'))}" />`);
            }
        }
        return scales.join('\n');
    },
};
export const qqquad = {
    controls: [
        rangeControl('columns', 'Columns', 1, 40, 1, 8),
        rangeControl('rows', 'Rows', 1, 40, 1, 8),
        rangeControl('jitter', 'Corner jitter', 0, 1, 0.01, 0.28),
        rangeControl('gap', 'Gap', 0, 40, 0.5, 4),
        rangeControl('strokeWidth', 'Stroke width', 0, 12, 0.5, 0),
        colorControl('colorA', 'Color A', '#6366f1'),
        colorControl('colorB', 'Color B', '#f97316'),
        colorControl('stroke', 'Stroke color', '#0f172a'),
        toggleControl('diagonalRamp', 'Diagonal color ramp', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const columns = Math.round(n('columns'));
        const rows = Math.round(n('rows'));
        const cellW = width / columns;
        const cellH = height / rows;
        const jitterX = cellW * n('jitter') * 0.5;
        const jitterY = cellH * n('jitter') * 0.5;
        const gap = n('gap') / 2;
        const quads = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < columns; col += 1) {
                const x = col * cellW + gap;
                const y = row * cellH + gap;
                const w = cellW - gap * 2;
                const h = cellH - gap * 2;
                const corners = [
                    { x, y },
                    { x: x + w, y },
                    { x: x + w, y: y + h },
                    { x, y: y + h },
                ].map((corner) => ({
                    x: corner.x + (random() - 0.5) * jitterX,
                    y: corner.y + (random() - 0.5) * jitterY,
                }));
                const t = b('diagonalRamp')
                    ? (row + col) / Math.max(1, rows + columns - 2)
                    : random();
                const stroke = n('strokeWidth') > 0
                    ? ` stroke="${s('stroke')}" stroke-width="${round(n('strokeWidth'))}"`
                    : '';
                quads.push(`<path d="${polyline(corners, true)}" fill="${mixColors(s('colorA'), s('colorB'), t)}"${stroke} />`);
            }
        }
        return quads.join('\n');
    },
};
export const cccircular = {
    controls: [
        rangeControl('rings', 'Rings', 1, 30, 1, 9),
        rangeControl('perRing', 'Items per ring', 1, 60, 1, 12),
        rangeControl('growth', 'Ring growth', 0.2, 2, 0.05, 1),
        rangeControl('dotSize', 'Item size', 0.5, 40, 0.5, 7),
        rangeControl('dotGrowth', 'Item growth', -1, 1, 0.05, 0.35),
        rangeControl('twist', 'Twist', -60, 60, 1, 12),
        rangeControl('scaleItems', 'Items per ring growth', 0, 20, 1, 4),
        colorControl('colorA', 'Color A', '#f8fafc'),
        colorControl('colorB', 'Color B', '#8b5cf6'),
        toggleControl('rings2', 'Draw guide rings', false),
    ],
    render: ({ width, height, n, s, b }) => {
        const rings = Math.round(n('rings'));
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = Math.min(width, height) / 2;
        const parts = [];
        for (let ring = 0; ring < rings; ring += 1) {
            const t = rings === 1 ? 1 : (ring + 1) / rings;
            const radius = maxRadius * t ** n('growth') * 0.92;
            const color = mixColors(s('colorA'), s('colorB'), t);
            const count = Math.max(1, Math.round(n('perRing') + ring * n('scaleItems')));
            const size = Math.max(0.2, n('dotSize') * (1 + n('dotGrowth') * (t - 0.5) * 2));
            if (b('rings2')) {
                parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="none" stroke="${color}" stroke-width="0.75" opacity="0.4" />`);
            }
            for (let index = 0; index < count; index += 1) {
                const angle = (index / count) * 360 + ring * n('twist');
                const p = polar(cx, cy, radius, angle);
                parts.push(`<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(size)}" fill="${color}" />`);
            }
        }
        return parts.join('\n');
    },
};
export const ttten = {
    controls: [
        rangeControl('columns', 'Columns', 1, 30, 1, 8),
        rangeControl('rows', 'Rows', 1, 30, 1, 8),
        rangeControl('strokeWidth', 'Stroke width', 0.5, 40, 0.5, 10),
        rangeControl('inset', 'Tile inset', 0, 0.4, 0.01, 0.08),
        rangeControl('variants', 'Tile variants', 2, 6, 1, 4),
        colorControl('colorA', 'Color A', '#fb7185'),
        colorControl('colorB', 'Color B', '#0ea5e9'),
        toggleControl('roundCaps', 'Round caps', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const columns = Math.round(n('columns'));
        const rows = Math.round(n('rows'));
        const cellW = width / columns;
        const cellH = height / rows;
        const inset = Math.min(cellW, cellH) * n('inset');
        const variants = Math.round(n('variants'));
        const cap = b('roundCaps') ? 'round' : 'butt';
        const tiles = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < columns; col += 1) {
                const x = col * cellW + inset;
                const y = row * cellH + inset;
                const w = cellW - inset * 2;
                const h = cellH - inset * 2;
                const variant = Math.floor(random() * variants);
                const color = mixColors(s('colorA'), s('colorB'), random());
                let d;
                switch (variant % 6) {
                    case 0:
                        d = `M${round(x)} ${round(y)} A${round(w)} ${round(h)} 0 0 1 ${round(x + w)} ${round(y + h)}`;
                        break;
                    case 1:
                        d = `M${round(x + w)} ${round(y)} A${round(w)} ${round(h)} 0 0 0 ${round(x)} ${round(y + h)}`;
                        break;
                    case 2:
                        d = `M${round(x)} ${round(y + h / 2)} H${round(x + w)}`;
                        break;
                    case 3:
                        d = `M${round(x + w / 2)} ${round(y)} V${round(y + h)}`;
                        break;
                    case 4:
                        d = `M${round(x)} ${round(y)} L${round(x + w)} ${round(y + h)}`;
                        break;
                    default:
                        d = `M${round(x + w)} ${round(y)} L${round(x)} ${round(y + h)}`;
                }
                tiles.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${round(n('strokeWidth'))}" stroke-linecap="${cap}" />`);
            }
        }
        return tiles.join('\n');
    },
};
export const tttwinkle = {
    controls: [
        rangeControl('count', 'Sparkles', 1, 200, 1, 40),
        rangeControl('size', 'Max size', 2, 160, 1, 42),
        rangeControl('sizeVariation', 'Size variation', 0, 1, 0.01, 0.65),
        rangeControl('spikes', 'Spikes', 3, 12, 1, 4),
        rangeControl('sharpness', 'Sharpness', 0.02, 0.9, 0.01, 0.18),
        rangeControl('rotation', 'Rotation spread', 0, 180, 1, 45),
        rangeControl('margin', 'Margin', 0, 0.3, 0.01, 0.05),
        colorControl('colorA', 'Color A', '#fde68a'),
        colorControl('colorB', 'Color B', '#f472b6'),
        toggleControl('smooth', 'Smooth spikes', true),
    ],
    render: ({ width, height, random, n, s, b }) => {
        const count = Math.round(n('count'));
        const margin = Math.min(width, height) * n('margin');
        return times(count, () => {
            const cx = margin + random() * (width - margin * 2);
            const cy = margin + random() * (height - margin * 2);
            const outer = n('size') * (1 - n('sizeVariation') * random());
            const points = starPoints({
                cx,
                cy,
                outer,
                inner: outer * n('sharpness'),
                spikes: n('spikes'),
                rotation: -90 + (random() - 0.5) * n('rotation') * 2,
            });
            const d = b('smooth') ? smoothPath(points, true, 0.6) : polyline(points, true);
            return `<path d="${d}" fill="${mixColors(s('colorA'), s('colorB'), random())}" />`;
        }).join('\n');
    },
};
export const bbburst = {
    controls: [
        rangeControl('rays', 'Rays', 3, 200, 1, 36),
        rangeControl('innerRadius', 'Inner radius', 0, 0.8, 0.01, 0.08),
        rangeControl('outerRadius', 'Outer radius', 0.1, 1.6, 0.01, 0.95),
        rangeControl('rayWidth', 'Ray width', 0.05, 1, 0.01, 0.5),
        rangeControl('lengthVariation', 'Length variation', 0, 1, 0.01, 0.25),
        rangeControl('rotation', 'Rotation', 0, 360, 1, 0),
        rangeControl('centerX', 'Center X', 0, 1, 0.01, 0.5),
        rangeControl('centerY', 'Center Y', 0, 1, 0.01, 0.5),
        colorControl('colorA', 'Color A', '#facc15'),
        colorControl('colorB', 'Color B', '#f97316'),
    ],
    render: ({ width, height, random, n, s }) => {
        const rays = Math.round(n('rays'));
        const cx = width * n('centerX');
        const cy = height * n('centerY');
        const maxRadius = Math.hypot(width, height) / 2;
        const step = 360 / rays;
        return times(rays, (index) => {
            const angle = index * step + n('rotation');
            const spanHalf = (step * n('rayWidth')) / 2;
            const inner = maxRadius * n('innerRadius');
            const outer = maxRadius * n('outerRadius') * (1 - n('lengthVariation') * random());
            const points = [
                polar(cx, cy, inner, angle - spanHalf),
                polar(cx, cy, outer, angle - spanHalf),
                polar(cx, cy, outer, angle + spanHalf),
                polar(cx, cy, inner, angle + spanHalf),
            ];
            return `<path d="${polyline(points, true)}" fill="${mixColors(s('colorA'), s('colorB'), index / rays)}" />`;
        }).join('\n');
    },
};
export const rrrainbow = {
    controls: [
        rangeControl('bands', 'Bands', 2, 60, 1, 9),
        rangeControl('innerRadius', 'Inner radius', 0, 1, 0.01, 0.2),
        rangeControl('bandWidth', 'Band width', 1, 120, 1, 26),
        rangeControl('gap', 'Gap', 0, 40, 0.5, 4),
        rangeControl('startAngle', 'Start angle', -360, 360, 1, 180),
        rangeControl('sweep', 'Sweep', 10, 360, 1, 180),
        rangeControl('centerX', 'Center X', 0, 1, 0.01, 0.5),
        rangeControl('centerY', 'Center Y', 0, 1, 0.01, 0.85),
        colorControl('colorA', 'Color A', '#ef4444'),
        colorControl('colorB', 'Color B', '#3b82f6'),
    ],
    render: ({ width, height, n, s }) => {
        const bands = Math.round(n('bands'));
        const cx = width * n('centerX');
        const cy = height * n('centerY');
        const start = n('startAngle');
        const sweep = Math.min(359.9, n('sweep'));
        const largeArc = sweep > 180 ? 1 : 0;
        return times(bands, (index) => {
            const radius = Math.min(width, height) * n('innerRadius') + index * (n('bandWidth') + n('gap'));
            const from = polar(cx, cy, radius, start);
            const to = polar(cx, cy, radius, start + sweep);
            return `<path d="M${round(from.x)} ${round(from.y)} A${round(radius)} ${round(radius)} 0 ${largeArc} 1 ${round(to.x)} ${round(to.y)}" fill="none" stroke="${mixColors(s('colorA'), s('colorB'), bands === 1 ? 0 : index / (bands - 1))}" stroke-width="${round(n('bandWidth'))}" stroke-linecap="butt" />`;
        }).join('\n');
    },
};
