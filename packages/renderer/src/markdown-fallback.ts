/**
 * Markdown fallback converter — transforms common markdown structures
 * into Burnish component HTML when the LLM returns plain markdown
 * instead of component markup.
 *
 * Conversion rules:
 * - Markdown tables → <burnish-table>
 * - Headers + bullet lists → <burnish-card>
 * - Key-value patterns (e.g. "**Label:** value") → <burnish-stat-bar>
 * - Standalone headers + paragraphs → <burnish-section>
 */

export interface FallbackOptions {
    /** Tag prefix (default: 'burnish-') */
    prefix?: string;
    /** Minimum table rows to trigger table conversion (default: 1) */
    minTableRows?: number;
}

interface MarkdownTable {
    headers: string[];
    rows: string[][];
    startIndex: number;
    endIndex: number;
}

interface KeyValuePair {
    label: string;
    value: string;
}

/**
 * Check if text contains markdown structures that can be converted
 * to Burnish components.
 */
export function containsMarkdownStructures(text: string): boolean {
    return (
        hasMarkdownTable(text) ||
        hasKeyValuePattern(text) ||
        hasHeaderWithList(text)
    );
}

/**
 * Convert markdown content to Burnish component HTML.
 * Returns the original text if no convertible structures are found.
 */
export function convertMarkdownToComponents(
    text: string,
    options: FallbackOptions = {},
): string {
    const prefix = options.prefix ?? 'burnish-';

    let result = text;

    // Order matters: tables first (most specific), then key-value, then header+list
    result = convertTables(result, prefix, options.minTableRows ?? 1);
    result = convertKeyValueBlocks(result, prefix);
    result = convertHeaderWithLists(result, prefix);

    return result;
}

// ---------------------------------------------------------------------------
// Markdown table detection and conversion
// ---------------------------------------------------------------------------

const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEPARATOR_RE = /^\|[\s:]*-{2,}[\s:]*(?:\|[\s:]*-{2,}[\s:]*)*\|$/;

function hasMarkdownTable(text: string): boolean {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 2; i++) {
        if (
            TABLE_ROW_RE.test(lines[i].trim()) &&
            TABLE_SEPARATOR_RE.test(lines[i + 1].trim()) &&
            TABLE_ROW_RE.test(lines[i + 2].trim())
        ) {
            return true;
        }
    }
    return false;
}

function extractTables(text: string, minRows: number): MarkdownTable[] {
    const lines = text.split('\n');
    const tables: MarkdownTable[] = [];
    let i = 0;

    while (i < lines.length - 2) {
        const headerLine = lines[i].trim();
        const separatorLine = lines[i + 1].trim();

        if (
            TABLE_ROW_RE.test(headerLine) &&
            TABLE_SEPARATOR_RE.test(separatorLine)
        ) {
            const headers = parsePipeCells(headerLine);
            const rows: string[][] = [];
            let j = i + 2;

            while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
                rows.push(parsePipeCells(lines[j].trim()));
                j++;
            }

            if (rows.length >= minRows) {
                tables.push({
                    headers,
                    rows,
                    startIndex: i,
                    endIndex: j - 1,
                });
            }

            i = j;
        } else {
            i++;
        }
    }

    return tables;
}

function parsePipeCells(line: string): string[] {
    // Remove leading/trailing pipes then split
    return line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());
}

function convertTables(text: string, prefix: string, minRows: number): string {
    const tables = extractTables(text, minRows);
    if (tables.length === 0) return text;

    const lines = text.split('\n');
    // Process from last to first so indices stay valid
    for (let t = tables.length - 1; t >= 0; t--) {
        const table = tables[t];
        const columns = table.headers.map(h => ({
            key: toKey(h),
            label: h,
        }));

        const rows = table.rows.map(cells => {
            const row: Record<string, string> = {};
            columns.forEach((col, idx) => {
                row[col.key] = stripInlineMarkdown(cells[idx] ?? '');
            });
            return row;
        });

        // Look for a title on the line before the table (markdown header)
        let title = '';
        if (table.startIndex > 0) {
            const prev = lines[table.startIndex - 1].trim();
            const headerMatch = prev.match(/^#{1,6}\s+(.+)$/);
            if (headerMatch) {
                title = headerMatch[1];
                // Remove the header line too
                table.startIndex--;
            }
        }

        const attrs = [
            title ? `title="${escapeAttr(title)}"` : '',
            `columns='${JSON.stringify(columns)}'`,
            `rows='${JSON.stringify(rows)}'`,
        ]
            .filter(Boolean)
            .join(' ');

        const component = `<${prefix}table ${attrs}></${prefix}table>`;
        lines.splice(
            table.startIndex,
            table.endIndex - table.startIndex + 1,
            component,
        );
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Key-value pattern detection and conversion
// ---------------------------------------------------------------------------

// Matches "**Label:** value" or "- **Label:** value"
const KV_RE = /^[-*]?\s*\*\*(.+?)\*\*[:\s]+(.+)$/;

function hasKeyValuePattern(text: string): boolean {
    const lines = text.split('\n').map(l => l.trim());
    let kvCount = 0;
    for (const line of lines) {
        if (KV_RE.test(line)) kvCount++;
    }
    // Need at least 2 key-value pairs to qualify
    return kvCount >= 2;
}

function convertKeyValueBlocks(text: string, prefix: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let kvBuffer: KeyValuePair[] = [];
    let kvStartIdx = -1;

    function flushKvBuffer() {
        if (kvBuffer.length >= 2) {
            const items = kvBuffer.map(kv => ({
                label: kv.label,
                value: stripInlineMarkdown(kv.value),
            }));
            result.push(
                `<${prefix}stat-bar items='${JSON.stringify(items)}'></${prefix}stat-bar>`,
            );
        } else {
            // Not enough pairs — keep original lines
            for (let i = kvStartIdx; i < kvStartIdx + kvBuffer.length; i++) {
                result.push(lines[i]);
            }
        }
        kvBuffer = [];
        kvStartIdx = -1;
    }

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const match = trimmed.match(KV_RE);

        if (match) {
            if (kvBuffer.length === 0) kvStartIdx = i;
            kvBuffer.push({ label: match[1], value: match[2] });
        } else {
            if (kvBuffer.length > 0) flushKvBuffer();
            // Skip empty lines between blocks but keep non-kv content
            result.push(lines[i]);
        }
    }
    if (kvBuffer.length > 0) flushKvBuffer();

    return result.join('\n');
}

// ---------------------------------------------------------------------------
// Header + list conversion
// ---------------------------------------------------------------------------

const HEADER_RE = /^(#{1,6})\s+(.+)$/;
const BULLET_RE = /^[-*+]\s+(.+)$/;

function hasHeaderWithList(text: string): boolean {
    const lines = text.split('\n').map(l => l.trim());
    for (let i = 0; i < lines.length - 1; i++) {
        if (HEADER_RE.test(lines[i])) {
            // Look for a bullet list within the next few lines
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                if (BULLET_RE.test(lines[j])) return true;
            }
        }
    }
    return false;
}

function convertHeaderWithLists(text: string, prefix: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();
        const headerMatch = trimmed.match(HEADER_RE);

        if (headerMatch) {
            const title = headerMatch[2];
            // Collect body: paragraphs and bullet items following the header
            const bodyParts: string[] = [];
            let j = i + 1;

            // Skip blank line after header
            if (j < lines.length && lines[j].trim() === '') j++;

            // Collect bullets
            const bullets: string[] = [];
            while (j < lines.length) {
                const lineTrimmed = lines[j].trim();
                if (lineTrimmed === '') {
                    // Blank line: check if more bullets follow
                    if (
                        j + 1 < lines.length &&
                        BULLET_RE.test(lines[j + 1].trim())
                    ) {
                        j++;
                        continue;
                    }
                    break;
                }
                const bulletMatch = lineTrimmed.match(BULLET_RE);
                if (bulletMatch) {
                    bullets.push(stripInlineMarkdown(bulletMatch[1]));
                } else if (HEADER_RE.test(lineTrimmed)) {
                    // Next header — stop
                    break;
                } else {
                    bodyParts.push(stripInlineMarkdown(lineTrimmed));
                }
                j++;
            }

            if (bullets.length > 0) {
                // Build card with meta from bullets
                const meta = bullets.map((b, idx) => ({
                    label: `${idx + 1}`,
                    value: b,
                }));
                const body = bodyParts.join(' ');
                const attrs = [
                    `title="${escapeAttr(stripInlineMarkdown(title))}"`,
                    body ? `body="${escapeAttr(body)}"` : '',
                    `meta='${JSON.stringify(meta)}'`,
                ]
                    .filter(Boolean)
                    .join(' ');

                result.push(
                    `<${prefix}card ${attrs}></${prefix}card>`,
                );
                i = j;
            } else if (bodyParts.length > 0) {
                // Header with paragraph content but no bullets → section
                const attrs = `label="${escapeAttr(stripInlineMarkdown(title))}"`;
                result.push(`<${prefix}section ${attrs}>`);
                result.push(
                    `<${prefix}message role="assistant" content="${escapeAttr(bodyParts.join(' '))}"></${prefix}message>`,
                );
                result.push(`</${prefix}section>`);
                i = j;
            } else {
                // Standalone header with no following content — keep as is
                result.push(lines[i]);
                i++;
            }
        } else {
            result.push(lines[i]);
            i++;
        }
    }

    return result.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a header string into a safe JSON key */
function toKey(header: string): string {
    return header
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
}

/** Strip inline markdown bold/italic/code formatting */
function stripInlineMarkdown(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .trim();
}

/** Escape a string for use in an HTML attribute */
function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
