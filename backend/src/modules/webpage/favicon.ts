/** Only the browser fetches the icon. Never proxy arbitrary public URLs. */
export function applyFavicon(html: string, publicUrl?: string): string {
    if (!publicUrl) return html;
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Invalid favicon URL');
    const escaped = url.href.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
    // The checked-in template contains these four fixed icon links.
    return html
        .replace(/<link\b[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, '')
        .replace(
            '</head>',
            `<link rel="icon" href="${escaped}" referrerpolicy="no-referrer" />\n</head>`,
        );
}
