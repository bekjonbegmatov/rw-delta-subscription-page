const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const ts = require('typescript');
require('reflect-metadata');
require.extensions['.ts'] = (module, filename) =>
    module._compile(
        ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
            },
        }).outputText,
        filename,
    );
const {
    rulesSchema,
    mergeExtras,
    responseFormat,
    verifiedStatus,
    vlessProfile,
    fetchExtraRules,
} = require('../src/modules/subscription/extras.ts');
const { applyFavicon } = require('../src/modules/webpage/favicon.ts');
const { configSchema } = require('../src/common/config/app-config/config.schema.ts');
const load = Module._load;
Module._load = function (id, ...rest) {
    if (id === '@common/axios/axios.service') return { AxiosService: class {} };
    if (id === '@common/config/app-config') return { TypedConfigService: class {} };
    return load.call(this, id, ...rest);
};
const { SubscriptionService } = require('../src/modules/subscription/subscription.service.ts');
Module._load = load;

const primary =
    'vless://00000000-0000-4000-8000-000000000001@primary.example.invalid:443?type=tcp&security=tls#Primary';
const extra =
    'vless://00000000-0000-4000-8000-000000000002@extra.example.invalid:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&sni=example.invalid&fp=random&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#Extra';
const headers = {
    'content-type': 'text/plain',
    'subscription-userinfo': 'upload=0; download=9; total=10; expire=1',
};
const rule = {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'demo',
    enabled: true,
    statuses: ['ACTIVE', 'EXPIRED', 'LIMITED'],
    mode: 'append',
    format: 'vless',
    content: extra,
};
const rules = { schema_version: 1, revision: 1, rules: [rule] };
const proof = (status) => ({
    response: {
        user: { shortUuid: 'synthetic', status },
        convertedUserInfo: { hwidCheckup: null },
        headers: {},
    },
});
const base64 = (text) => Buffer.from(Buffer.from(text).toString('base64'));
const decode = (result) => Buffer.from(result.body.toString(), 'base64').toString();
async function upstream(t, handler) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    return 'http://127.0.0.1:' + server.address().port;
}

test('append keeps panel first, deduplicates credentials and preserves subscription metadata', () => {
    const result = mergeExtras(
        base64(primary),
        headers,
        {
            ...rules,
            rules: [rule, { ...rule, id: 'different', content: extra.replace('#Extra', '#Other') }],
        },
        'ACTIVE',
    );
    assert.equal(decode(result), primary + '\n' + extra);
    assert.equal(headers['subscription-userinfo'], 'upload=0; download=9; total=10; expire=1');
    assert.equal(result.headers['subscription-userinfo'], undefined);
    assert.equal(result.headers['cache-control'], 'no-store, private');
});
test('matching replace removes panel only, keeps all matching additions in order', () => {
    const result = mergeExtras(
        base64(primary),
        headers,
        { ...rules, rules: [rule, { ...rule, id: 'second', mode: 'replace' }] },
        'EXPIRED',
    );
    assert.equal(decode(result), extra);
});
test('status matching, disabled rules and explicit disabled audience', () => {
    assert.equal(mergeExtras(base64(primary), headers, rules, 'DISABLED'), null);
    assert.equal(
        mergeExtras(
            base64(primary),
            headers,
            { ...rules, rules: [{ ...rule, enabled: false }] },
            'ACTIVE',
        ),
        null,
    );
    assert.ok(
        mergeExtras(
            base64(primary),
            headers,
            { ...rules, rules: [{ ...rule, statuses: ['DISABLED'] }] },
            'DISABLED',
        ),
    );
});
test('plain, empty expired base64 and empty JSON panel responses get additions', () => {
    assert.equal(
        mergeExtras(Buffer.from(primary), headers, rules, 'LIMITED').body.toString(),
        primary + '\n' + extra,
    );
    assert.equal(decode(mergeExtras(Buffer.alloc(0), headers, rules, 'EXPIRED')), extra);
    assert.equal(
        JSON.parse(
            mergeExtras(
                Buffer.from('[]'),
                { 'content-type': 'application/json' },
                rules,
                'EXPIRED',
                'json',
            ).body,
        ).length,
        1,
    );
});
test('VLESS reality conversion retains credentials, flow and client transport settings', () => {
    const profile = vlessProfile(extra),
        outbound = profile.outbounds[0];
    assert.equal(outbound.settings.vnext[0].users[0].flow, 'xtls-rprx-vision');
    assert.equal(outbound.streamSettings.realitySettings.publicKey, 'A'.repeat(43));
    assert.equal(outbound.streamSettings.realitySettings.fingerprint, 'random');
    assert.equal(profile.remarks, 'Extra');
    assert.equal(
        vlessProfile(primary.replace('type=tcp', 'type=ws&path=%2Fsocket&host=cdn.example.invalid'))
            .outbounds[0].streamSettings.wsSettings.path,
        '/socket',
    );
    assert.equal(
        vlessProfile(primary.replace('type=tcp', 'type=grpc&serviceName=grpc&mode=multi'))
            .outbounds[0].streamSettings.grpcSettings.multiMode,
        true,
    );
});
test('Xray JSON profiles stay separate; native JSON only targets JSON consumers', () => {
    const native = { ...vlessProfile(primary), routing: { rules: [] }, remarks: 'Native' };
    const config = {
        ...rules,
        rules: [
            rule,
            { ...rule, id: 'other', format: 'xray_json', content: JSON.stringify(native) },
        ],
    };
    const result = mergeExtras(
        Buffer.from(JSON.stringify(vlessProfile(primary))),
        {},
        config,
        'ACTIVE',
        'v2ray-json',
    );
    assert.equal(JSON.parse(result.body).length, 3);
    assert.deepEqual(JSON.parse(result.body)[2], native);
    assert.equal(
        decode(mergeExtras(base64(primary), headers, config, 'ACTIVE')),
        primary + '\n' + extra,
    );
});
test('unsupported, encrypted, invalid, HTML, YAML and sing-box are untouched', () => {
    for (const body of [
        'age1encrypted',
        'happ://crypt4/secret',
        '<html>denied</html>',
        'proxies:\n- name: demo',
        '{"outbounds":[{"type":"vless"}]}',
        'bm90IGEgc3Vic2NyaXB0aW9u',
        '{broken',
    ]) {
        assert.equal(responseFormat(Buffer.from(body), headers), null);
    }
    for (const type of ['clash', 'mihomo', 'singbox', 'stash'])
        assert.equal(responseFormat(base64(primary), headers, type), null);
    assert.equal(responseFormat(base64(primary), { 'content-type': 'text/html' }), null);
});
test('malformed additions never damage panel response', () => {
    for (const content of ['not a key', extra.replace(':443', ':99999'), extra + '%0A']) {
        assert.equal(
            mergeExtras(
                base64(primary),
                headers,
                { ...rules, rules: [{ ...rule, content, mode: 'replace' }] },
                'ACTIVE',
            ),
            null,
        );
    }
});

const { normalizeUri, proxyProfile } = require('../src/modules/subscription/proxy-uri.ts');
const fixtures = require('./fixtures/proxy-uris.json');
test('shared URI fixtures: lossless admission and conservative conversion', () => {
    for (const fixture of fixtures.valid) {
        assert.equal(normalizeUri(fixture.input), fixture.normalized, fixture.name);
        if (fixture.convert) {
            const profile = proxyProfile(fixture.input);
            assert.equal(profile.inbounds[0].listen, '127.0.0.1', fixture.name);
        } else assert.throws(() => proxyProfile(fixture.input), fixture.name);
    }
    for (const input of fixtures.invalid) assert.throws(() => normalizeUri(input));
});
test('PCS, ECH, XHTTP extra, raw plus and encoded passwords survive conversion', () => {
    const profile = proxyProfile(
        fixtures.valid.find((f) => f.name === 'certificate-pinning').input,
    );
    const tls = profile.outbounds[0].streamSettings.tlsSettings;
    assert.equal(tls.pinnedPeerCertSha256, Array(32).fill('AA').join(':'));
    assert.equal(tls.verifyPeerCertByName, 'cert.example.invalid');
    assert.equal(tls.echConfigList, 'A+B');
    assert.equal(tls.fingerprint, 'qq');
    assert.equal(profile.remarks, ' LTE');
    const xhttp = proxyProfile(fixtures.valid.find((f) => f.name === 'xhttp-extra').input);
    assert.equal(
        xhttp.outbounds[0].streamSettings.xhttpSettings.extra.downloadSettings.address,
        'download.example.invalid',
    );
    const trojan = proxyProfile(fixtures.valid.find((f) => f.name === 'trojan').input);
    assert.equal(trojan.outbounds[0].settings.servers[0].password, 'p@ss:word');
    assert.equal(trojan.outbounds[0].settings.servers[0].address, '2001:db8::1');
});
test('unknown URI parameters are passed through, not discarded to make JSON', () => {
    const content = fixtures.valid.find((f) => f.name === 'unknown-parameter').input;
    const next = { ...rules, rules: [{ ...rule, content }] };
    const plain = mergeExtras(Buffer.from(primary), headers, next, 'ACTIVE');
    assert.equal(plain.body.toString(), primary + '\n' + content);
    const original = Buffer.from(JSON.stringify([vlessProfile(primary)]));
    assert.equal(mergeExtras(original, {}, next, 'ACTIVE'), null);
});
test('incompatible or partially convertible replace rule cannot wipe original or valid append', () => {
    const incompatible = fixtures.valid.find((f) => f.name === 'unknown-parameter').input;
    const original = vlessProfile(primary);
    const next = {
        ...rules,
        rules: [
            { ...rule, content: extra + '\n' + incompatible, mode: 'replace' },
            { ...rule, id: 'other', content: extra, mode: 'append' },
        ],
    };
    const result = mergeExtras(Buffer.from(JSON.stringify([original])), {}, next, 'ACTIVE');
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0], original);
});
test('proof requires a matching real user, known status and explicit HWID check result', () => {
    for (const status of ['ACTIVE', 'EXPIRED', 'LIMITED', 'DISABLED'])
        assert.equal(verifiedStatus(proof(status), 'synthetic'), status);
    assert.equal(verifiedStatus(proof('ACTIVE'), 'another'), null);
    assert.equal(verifiedStatus(proof('unknown'), 'synthetic'), null);
    const oldPanel = proof('ACTIVE');
    delete oldPanel.response.convertedUserInfo.hwidCheckup;
    assert.equal(verifiedStatus(oldPanel, 'synthetic'), null);
    for (const check of [
        {
            subscriptionAllowed: false,
            maxDeviceReached: false,
            hwidNotSupported: false,
            limitBypassed: false,
        },
        {
            subscriptionAllowed: true,
            maxDeviceReached: true,
            hwidNotSupported: false,
            limitBypassed: false,
        },
        {
            subscriptionAllowed: true,
            maxDeviceReached: false,
            hwidNotSupported: true,
            limitBypassed: false,
        },
    ]) {
        const data = proof('ACTIVE');
        data.response.convertedUserInfo.hwidCheckup = check;
        assert.equal(verifiedStatus(data, 'synthetic'), null);
    }
});
test('HWID denial headers stop merging even for HTTP 200 configs', () => {
    for (const name of ['x-hwid-limit', 'x-hwid-max-devices-reached', 'x-hwid-not-supported']) {
        assert.equal(
            mergeExtras(base64(primary), { ...headers, [name]: 'true' }, rules, 'ACTIVE'),
            null,
        );
        const data = proof('ACTIVE');
        data.response.headers[name] = 'true';
        assert.equal(verifiedStatus(data, 'synthetic'), null);
    }
});
test('private fetch uses only dedicated token, fresh every time, validates schema', async (t) => {
    let calls = 0;
    const url = await upstream(t, (req, res) => {
        calls++;
        assert.equal(req.headers.authorization, 'Bearer test-token');
        assert.equal(req.headers.cookie, undefined);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(rules));
    });
    assert.deepEqual(await fetchExtraRules(url, 'test-token'), rules);
    await fetchExtraRules(url, 'test-token');
    assert.equal(calls, 2);
    assert.equal(rulesSchema.safeParse({ ...rules, schema_version: 2 }).success, false);
});
test('private fetch rejects redirects, oversized data and timeout', async (t) => {
    const redirect = await upstream(t, (_, res) => {
        res.writeHead(302, { Location: 'https://example.invalid' });
        res.end();
    });
    await assert.rejects(fetchExtraRules(redirect, 'test'));
    const large = await upstream(t, (_, res) => res.end('x'.repeat(1024 * 1024 + 1)));
    await assert.rejects(fetchExtraRules(large, 'test'));
    const down = await upstream(t, () => {});
    await assert.rejects(fetchExtraRules(down, 'test'));
});
test('service requires panel success + fresh rules + access, cleans content headers and never changes expiry', async (t) => {
    const url = await upstream(t, (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(rules));
    });
    let accessCalls = 0;
    const source = {
        subscription: base64(primary),
        status: 200,
        headers: { ...headers, 'content-length': '1', etag: 'old', 'content-encoding': 'gzip' },
    };
    const service = new SubscriptionService(
        {
            getSubscription: async () => source,
            getExtraAccess: async () => {
                accessCalls++;
                return proof('EXPIRED');
            },
        },
        { get: (key) => (key === 'SUBSCRIPTION_RULES_URL' ? url : 'test-token') },
    );
    const sent = { headers: {}, body: null, destroyed: false };
    const res = {
        set(value) {
            Object.assign(sent.headers, value);
        },
        removeHeader(name) {
            delete sent.headers[name];
        },
        status() {
            return this;
        },
        send(value) {
            sent.body = value;
        },
        socket: {
            destroy() {
                sent.destroyed = true;
            },
        },
    };
    await service.serveSubscriptionPage(
        '127.0.0.1',
        { headers: { 'x-hwid': 'synthetic-hwid' } },
        res,
        'synthetic',
    );
    assert.equal(accessCalls, 1);
    assert.equal(decode({ body: sent.body }), primary + '\n' + extra);
    assert.equal(sent.headers['subscription-userinfo'], headers['subscription-userinfo']);
    assert.equal(sent.headers['content-length'], undefined);
    assert.equal(sent.headers['content-encoding'], undefined);
    source.status = 204;
    sent.body = null;
    await service.serveSubscriptionPage('127.0.0.1', { headers: {} }, res, 'synthetic');
    assert.equal(accessCalls, 1);
    assert.equal(sent.body, source.subscription);
});
test('favicon defaults, override escaping and schema validation', () => {
    const html = fs.readFileSync('../frontend/index.html', 'utf8');
    assert.equal(applyFavicon(html), html);
    const result = applyFavicon(html, 'https://cdn.example.invalid/icon.png?a=1&b=2');
    assert.equal((result.match(/rel="icon"/g) || []).length, 1);
    assert.ok(result.includes('a=1&amp;b=2'));
    assert.ok(!result.includes('/assets/favicon'));
    assert.ok(!applyFavicon(html, 'https://cdn.example.invalid/<%=evil%>.svg').includes('<%=evil'));
    const config = {
        REMNAWAVE_PANEL_URL: 'https://example.invalid',
        REMNAWAVE_API_TOKEN: 'synthetic',
        INTERNAL_JWT_SECRET: 'synthetic',
    };
    for (const url of [
        'javascript:alert(1)',
        'http://example.invalid/icon.png',
        'https://user:pass@example.invalid/x',
        'broken',
    ])
        assert.equal(configSchema.safeParse({ ...config, FAVICON_PUBLIC_URL: url }).success, false);
    assert.equal(configSchema.safeParse({ ...config, FAVICON_PUBLIC_URL: '' }).success, true);
    assert.equal(
        configSchema.safeParse({
            ...config,
            SUBSCRIPTION_RULES_URL: 'http://django:8080/internal/subscription-page/rules/',
        }).success,
        false,
    );
});
