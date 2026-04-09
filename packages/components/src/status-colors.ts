/**
 * Shared status-to-color mapping for burnish components.
 * Maps semantic status names to CSS custom property expressions.
 */

const STATUS_COLOR_MAP: Record<string, string> = {
    success: 'var(--burnish-success, #16a34a)',
    healthy: 'var(--burnish-success, #16a34a)',
    warning: 'var(--burnish-warning, #ca8a04)',
    error: 'var(--burnish-error, #dc2626)',
    failing: 'var(--burnish-error, #dc2626)',
    failed: 'var(--burnish-error, #dc2626)',
    info: 'var(--burnish-info, #6366f1)',
    muted: 'var(--burnish-muted, #9C8F8F)',
    'no-data': 'var(--burnish-muted, #9C8F8F)',
    locked: 'var(--burnish-muted, #9C8F8F)',
    archived: 'var(--burnish-muted, #9C8F8F)',
};

const DEFAULT_COLOR = 'var(--burnish-muted, #9C8F8F)';

/**
 * Resolve a status or color name to a CSS value.
 *
 * If `value` matches a known status name, returns the corresponding CSS custom property.
 * Otherwise returns `value` as-is (allowing raw CSS colors to pass through),
 * falling back to the default muted color.
 */
export function resolveStatusColor(value?: string): string {
    if (!value) return DEFAULT_COLOR;
    return STATUS_COLOR_MAP[value.toLowerCase()] ?? value ?? DEFAULT_COLOR;
}
