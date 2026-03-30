/**
 * Component mapper — auto-infers the best Burnish component for a given data shape.
 *
 * This is the supplementary auto-inference layer. The primary mapping is done
 * via the LLM system prompt, but this module handles cases where the LLM
 * returns raw JSON without HTML component markup.
 */

export interface ComponentSuggestion {
    tag: string;
    attrs: Record<string, string>;
}

export interface MapperOptions {
    /** Tag prefix (default: 'burnish-') */
    prefix?: string;
}

/**
 * Inspect a JSON data structure and suggest the best component to render it.
 *
 * Heuristics:
 * - If data has a `_ui_hint` field, use that directly
 * - Array of uniform objects → table
 * - Array of {label, value} objects → stat-bar
 * - Object with numeric + date/label fields → chart candidate
 * - Single object with key-value pairs → card
 * - Single number/string → metric
 */
export function inferComponent(
    data: unknown,
    options: MapperOptions = {},
): ComponentSuggestion | null {
    const prefix = options.prefix ?? 'burnish-';

    if (data == null) return null;

    // Check for explicit UI hint
    if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
        const obj = data as Record<string, unknown>;
        if (typeof obj._ui_hint === 'string') {
            return handleHint(obj._ui_hint, obj, prefix);
        }
    }

    // Single number → metric
    if (typeof data === 'number') {
        return {
            tag: `${prefix}metric`,
            attrs: { value: String(data) },
        };
    }

    // Single string → metric (if short) or message
    if (typeof data === 'string') {
        if (data.length <= 50) {
            return { tag: `${prefix}metric`, attrs: { value: data } };
        }
        return { tag: `${prefix}message`, attrs: { role: 'assistant', content: data } };
    }

    // Array handling
    if (Array.isArray(data)) {
        if (data.length === 0) return null;

        const first = data[0];
        if (typeof first !== 'object' || first === null) return null;

        // Array of {label, value} → stat-bar
        if ('label' in first && 'value' in first && Object.keys(first).length <= 3) {
            return {
                tag: `${prefix}stat-bar`,
                attrs: { items: JSON.stringify(data) },
            };
        }

        // Array of uniform objects → table
        const keys = Object.keys(first);
        if (keys.length > 0) {
            const columns = keys.map(k => ({ key: k, label: formatLabel(k) }));
            return {
                tag: `${prefix}table`,
                attrs: {
                    columns: JSON.stringify(columns),
                    rows: JSON.stringify(data),
                },
            };
        }
    }

    // Object handling
    if (typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        const keys = Object.keys(obj).filter(k => !k.startsWith('_'));

        // Chart-like: has labels + datasets
        if ('labels' in obj && 'datasets' in obj) {
            return {
                tag: `${prefix}chart`,
                attrs: {
                    type: 'line',
                    config: JSON.stringify({ data: obj }),
                },
            };
        }

        // Object with few fields → card
        if (keys.length <= 8) {
            const title = (obj.name || obj.title || obj.id || keys[0]) as string;
            const status = obj.status as string | undefined;
            const meta = keys
                .filter(k => k !== 'name' && k !== 'title' && k !== 'id' && k !== 'status')
                .map(k => ({ label: formatLabel(k), value: String(obj[k]) }));

            return {
                tag: `${prefix}card`,
                attrs: {
                    title: String(title),
                    ...(status ? { status } : {}),
                    meta: JSON.stringify(meta),
                },
            };
        }

        // Large object → table of key-value pairs
        const rows = keys.map(k => ({ key: k, value: String(obj[k]) }));
        return {
            tag: `${prefix}table`,
            attrs: {
                columns: JSON.stringify([
                    { key: 'key', label: 'Property' },
                    { key: 'value', label: 'Value' },
                ]),
                rows: JSON.stringify(rows),
            },
        };
    }

    return null;
}

function handleHint(
    hint: string,
    obj: Record<string, unknown>,
    prefix: string,
): ComponentSuggestion {
    const tag = hint.startsWith(prefix) ? hint : `${prefix}${hint}`;
    // Strip _ui_hint and pass remaining fields as attrs
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k === '_ui_hint') continue;
        attrs[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return { tag, attrs };
}

function formatLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^\w/, c => c.toUpperCase())
        .trim();
}
