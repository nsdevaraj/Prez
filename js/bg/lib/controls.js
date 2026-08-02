export function rangeControl(key, label, min, max, step, value) {
    return { kind: 'range', key, label, min, max, step, value };
}
export function colorControl(key, label, value) {
    return { kind: 'color', key, label, value };
}
export function selectControl(key, label, options, value) {
    const normalized = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
    return { kind: 'select', key, label, options: normalized, value };
}
export function toggleControl(key, label, value) {
    return { kind: 'toggle', key, label, value };
}
export function defaultParams(controls) {
    const params = {};
    for (const control of controls) {
        params[control.key] = control.value;
    }
    return params;
}
