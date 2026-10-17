const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const ts = require('typescript');

// Use the repository's pinned TypeScript; no extra test runtime or live services.
require.extensions['.ts'] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, filename,
);
const { fetchAppearance } = require('../src/modules/webpage/appearance-fetch.ts');
const { defaultAppearance } = require('../src/modules/webpage/appearance-contract.ts');
const { checkAssetsCookieMiddleware } = require('../src/common/middlewares/check-assets-cookie.middleware.ts');
const { configSchema } = require('../src/common/config/app-config/config.schema.ts');
const jwt = require('jsonwebtoken');
const active = { id: '73d54f80-9071-4408-a681-e75ba67bb626', enabled: true, type: 'info', title: '', message: 'Test', timeout_seconds: 0, dismissible: true };

async function upstream(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return 'http://127.0.0.1:' + server.address().port;
}

test('unconfigured source uses safe defaults without renewal', async () => {
    assert.deepEqual(await fetchAppearance(), { ...defaultAppearance, renewal_enabled: false });
});
test('appearance preserves the renewal toggle and accepts legacy effect defaults', async t => {
    const { effect, effect_color, effect_speed, effect_opacity, ...legacyTheme } = defaultAppearance.theme;
    const { renewal_subtitle, ...legacy } = defaultAppearance;
    const url = await upstream(t, (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...legacy, renewal_enabled: false, theme: legacyTheme }));
    });
    assert.deepEqual(await fetchAppearance(url), { ...defaultAppearance, renewal_enabled: false });
});
test('appearance fetch preserves custom and empty renewal captions', async t => {
    let subtitle = '🔑 Ваш ключ останется прежним';
    const url = await upstream(t, (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...defaultAppearance, renewal_subtitle: subtitle }));
    });
    assert.equal((await fetchAppearance(url)).renewal_subtitle, subtitle);
    subtitle = '';
    assert.equal((await fetchAppearance(url)).renewal_subtitle, '');
});
test('appearance URLs reject malformed values, credentials and non-origin preview URLs', () => {
    const base = { REMNAWAVE_PANEL_URL: 'https://panel.example.invalid', REMNAWAVE_API_TOKEN: 'synthetic', INTERNAL_JWT_SECRET: 'synthetic' };
    for (const value of ['https://', 'javascript:alert(1)', 'https://user:pass@example.invalid']) {
        assert.equal(configSchema.safeParse({ ...base, SUBSCRIPTION_APPEARANCE_URL: value }).success, false);
    }
    for (const value of ['https://', 'https://admin.example.invalid/', 'https://admin.example.invalid/path']) {
        assert.equal(configSchema.safeParse({ ...base, SUBSCRIPTION_PREVIEW_ORIGIN: value }).success, false);
    }
    assert.equal(configSchema.safeParse({ ...base, SUBSCRIPTION_APPEARANCE_URL: 'https://admin.example.invalid/api/public/subscription-page/', SUBSCRIPTION_PREVIEW_ORIGIN: 'https://admin.example.invalid' }).success, true);
});
test('fetches every time, strips disabled alerts and does not forward auth', async t => {
    let count = 0;
    const url = await upstream(t, (req, res) => {
        count++;
        assert.equal(req.headers.authorization, undefined);
        assert.equal(req.headers.cookie, undefined);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...defaultAppearance, alerts: [active, { ...active, id: 'bca2a404-3832-4d14-8c88-23aa6c22bca8', enabled: false }] }));
    });
    assert.equal((await fetchAppearance(url)).alerts.length, 1);
    await fetchAppearance(url);
    assert.equal(count, 2);
});
test('rejects malformed appearance instead of applying CSS or unknown schema', async t => {
    const url = await upstream(t, (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...defaultAppearance, theme: { ...defaultAppearance.theme, accent: 'url(https://example.invalid)' } }));
    });
    await assert.rejects(fetchAppearance(url));
});
test('rejects redirects and oversized upstream responses', async t => {
    const redirect = await upstream(t, (_, res) => { res.writeHead(302, { Location: 'https://example.invalid' }); res.end(); });
    await assert.rejects(fetchAppearance(redirect));
    const large = await upstream(t, (_, res) => res.end('x'.repeat(70000)));
    await assert.rejects(fetchAppearance(large));
});
test('times out an unavailable appearance source', async t => {
    const url = await upstream(t, () => {});
    await assert.rejects(fetchAppearance(url), e => e.code === 'ECONNABORTED');
});
test('preview cookie grants static assets only, never configuration', () => {
    const old = process.env.INTERNAL_JWT_SECRET;
    process.env.INTERNAL_JWT_SECRET = 'synthetic-appearance-test-key-not-a-real-secret';
    try {
        const cookie = jwt.sign({ purpose: 'appearance-preview' }, process.env.INTERNAL_JWT_SECRET);
        for (const [path, allowed] of [['/test.js', true], ['/test.woff2', true], ['/.app-config-v2.json', false], ['/api/config', false]]) {
            let next = false, destroyed = false;
            const req = { cookies: { appearance_preview: cookie }, path };
            const res = { socket: { destroy() { destroyed = true; } } };
            checkAssetsCookieMiddleware(req, res, () => { next = true; });
            assert.equal(next, allowed, path); assert.equal(destroyed, !allowed, path);
        }
    } finally {
        if (old === undefined) delete process.env.INTERNAL_JWT_SECRET; else process.env.INTERNAL_JWT_SECRET = old;
    }
});
