/**
 * Template learning — client-side integration for learning from
 * positively-rated responses and injecting proven templates.
 */

import { TemplateStore, extractHtmlStructure, deriveToolKey } from '@burnish/app';

/** Singleton template store instance */
const templateStore = new TemplateStore();

/**
 * Record a positive signal for a response node.
 *
 * Called when:
 * - A user drills down into a result (engagement signal)
 * - A response renders cleanly with burnish-* components
 *
 * @param html - The response HTML content
 * @param prompt - The original user prompt
 * @param signal - Type of positive signal
 * @param toolName - Optional tool name that produced this response
 * @param serverName - Optional server name
 */
export async function recordPositiveSignal(html, prompt, signal, toolName, serverName) {
    if (!html || !prompt) return null;

    // Only learn from responses that contain burnish-* components
    if (!/<burnish-[a-z]/.test(html)) return null;

    const toolKey = deriveToolKey(toolName, serverName);

    try {
        const template = await templateStore.saveTemplate(toolKey, html, prompt, signal);
        if (template) {
            console.log(`[template-learning] Saved ${signal} template for "${toolKey}" (use count: ${template.useCount})`);
        }
        return template;
    } catch (err) {
        console.warn('[template-learning] Failed to save template:', err);
        return null;
    }
}

/**
 * Build extraInstructions string from learned templates.
 *
 * Fetches the best matching templates and formats them for injection
 * into the system prompt. Returns empty string if no templates exist.
 *
 * @param toolKey - Optional tool key to prioritize matching templates
 */
export async function getTemplateInstructions(toolKey) {
    try {
        const templates = await templateStore.getBestTemplates(toolKey, 2);
        if (templates.length === 0) return '';

        // Format as extraInstructions text
        const sections = templates.map((t, i) => {
            const strength = t.useCount >= 3
                ? 'Users consistently prefer this layout'
                : 'This layout received positive feedback';
            const toolLabel = t.toolKey === '_general' ? 'general queries' : `"${t.toolKey}" results`;

            return `### Proven Layout ${i + 1} (for ${toolLabel})
${strength}. Follow this structure when handling similar requests:
\`\`\`html
${t.htmlStructure}
\`\`\``;
        });

        return `## Learned Layout Patterns
The following layouts were rated positively by users. Use them as templates when responding to similar tool results. Adapt the data but keep the component structure.

${sections.join('\n\n')}`;
    } catch (err) {
        console.warn('[template-learning] Failed to get templates:', err);
        return '';
    }
}

/**
 * Get all stored templates (for management UI).
 */
export async function getAllTemplates() {
    return templateStore.getAllTemplates();
}

/**
 * Delete a specific template.
 */
export async function deleteTemplate(id) {
    return templateStore.deleteTemplate(id);
}

/**
 * Clear all learned templates.
 */
export async function clearAllTemplates() {
    return templateStore.clear();
}

/**
 * Get the template store instance (for advanced usage).
 */
export function getTemplateStore() {
    return templateStore;
}
