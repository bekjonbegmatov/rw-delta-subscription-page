const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { JwtService } = require('@nestjs/jwt');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true },
}).outputText, filename);
const originalLoad = Module._load;
Module._load = function (id, parent, main) {
    if (id === '@common/config/app-config') return {};
    if (id === '@common/constants') return require('../src/common/constants/ignored-headers.constant.ts');
    return originalLoad.call(this, id, parent, main);
};
const { RenewalService, RenewalController, RENEWAL_ROUTE } = require('../src/modules/webpage/renewal.service.ts');
const { configSchema } = require('../src/common/config/app-config/config.schema.ts');
const { headerFilterMiddleware } = require('../src/common/middlewares/header-filter.middleware.ts');
Module._load = originalLoad;

const config = {
    SUBSCRIPTION_RENEWAL_URL: 'http://private.example.invalid/internal/subscription-page/renewal/',
    SUBSCRIPTION_RENEWAL_TOKEN: 'synthetic-server-token-'.repeat(3),
    SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN: 'https://sub.example.invalid',
};
const jwt = new JwtService({ secret: 'synthetic-secret-'.repeat(4) });
const make = (overrides = {}) => new RenewalService({ get: key => ({ ...config, ...overrides })[key] }, jwt);
const request = (token, headers = {}) => ({ headers: {
    'content-type': 'application/json',
    origin: config.SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN, 'sec-fetch-site': 'same-origin', 'x-subscription-renewal': token, ...headers,
} });

test('renewal config is optional, but all settings are required together', () => {
    const base = { REMNAWAVE_PANEL_URL: 'https://panel.example.invalid', REMNAWAVE_API_TOKEN: 'test', INTERNAL_JWT_SECRET: 'test' };
    assert.equal(configSchema.safeParse(base).success, true);
    assert.equal(configSchema.safeParse({ ...base, ...config }).success, true);
    assert.equal(configSchema.safeParse({ ...base, SUBSCRIPTION_RENEWAL_URL: config.SUBSCRIPTION_RENEWAL_URL }).success, false);
    assert.equal(configSchema.safeParse({ ...base, ...config, SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN: 'https://sub.example.invalid/path' }).success, false);
    assert.equal(make({ SUBSCRIPTION_RENEWAL_URL: '' }).pageToken('synthetic'), null);
});

test('two page tokens bind separate subscriptions without depending on cookies', async t => {
    const service = make();
    const seen = [];
    t.mock.method(global, 'fetch', async (url, options) => {
        seen.push(JSON.parse(options.body));
        assert.equal(url, config.SUBSCRIPTION_RENEWAL_URL);
        assert.equal(options.headers.Authorization, `Bearer ${config.SUBSCRIPTION_RENEWAL_TOKEN}`);
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(options.headers['X-Forwarded-For'], undefined);
        assert.equal(options.redirect, 'error');
        return new Response(JSON.stringify({ available: true }));
    });
    await service.request(request(service.pageToken('first-synthetic')), { action: 'options' });
    await service.request(request(service.pageToken('second-synthetic')), { action: 'options' });
    assert.deepEqual(seen.map(v => v.short_uuid), ['first-synthetic', 'second-synthetic']);
});

test('missing, expired, wrong-audience and tampered page tokens never reach backend', async t => {
    const service = make();
    const fetch = t.mock.method(global, 'fetch');
    for (const token of ['', 'bad', jwt.sign({ shortUuid: 'synthetic', jti: 'id' }),
        jwt.sign({ shortUuid: 'synthetic', jti: 'id' }, { audience: 'subscription-page-renewal', expiresIn: -1 }),
        service.pageToken('synthetic') + 'x']) {
        await assert.rejects(service.request(request(token), { action: 'options' }), e => e.getStatus() === 401);
    }
    assert.equal(fetch.mock.callCount(), 0);
});

test('cross-site, missing origin and form POSTs fail closed', async t => {
    const service = make();
    const token = service.pageToken('synthetic');
    const fetch = t.mock.method(global, 'fetch');
    for (const headers of [{ origin: undefined }, { origin: 'https://evil.example.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
        await assert.rejects(service.request(request(token, headers), { action: 'checkout' }), e => e.getStatus() === 403);
    }
    await assert.rejects(service.request(request(token, { 'content-type': 'application/x-www-form-urlencoded' }), {}), e => e.getStatus() === 403);
    assert.equal(fetch.mock.callCount(), 0);
});

test('caller cannot replace subscription, endpoint or identity', async () => {
    const service = make();
    for (const body of [{ action: 'options', short_uuid: 'other' }, { action: 'checkout', user_id: 9 }, { action: 'delete' }, [], null]) {
        await assert.rejects(service.request(request(service.pageToken('synthetic')), body), e => e.getStatus() === 400);
    }
});

test('checkout timeout is never retried', async t => {
    const service = make();
    const fetch = t.mock.method(global, 'fetch', async () => { throw new Error('synthetic network failure'); });
    await assert.rejects(service.request(request(service.pageToken('synthetic')), { action: 'checkout' }), e => e.getStatus() === 503);
    assert.equal(fetch.mock.callCount(), 1);
});

test('backend validation stays actionable without forwarding customer records', async t => {
    const service = make();
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify(['Цена изменилась.']), { status: 400 }));
    await assert.rejects(service.request(request(service.pageToken('synthetic')), { action: 'checkout' }), e => e.getStatus() === 400 && e.message === 'Цена изменилась.');
});

test('per-page throttle bounds panel lookups', async t => {
    const service = make(), token = service.pageToken('synthetic');
    const fetch = t.mock.method(global, 'fetch', async () => new Response('{}'));
    for (let i = 0; i < 40; i++) await service.request(request(token), { action: 'options' });
    await assert.rejects(service.request(request(token), { action: 'options' }), e => e.getStatus() === 429);
    assert.equal(fetch.mock.callCount(), 40);
});

test('real Nest POST parses JSON before the header filter and works with custom prefix', async t => {
    const { Module: NestModule } = require('@nestjs/common');
    const { NestFactory } = require('@nestjs/core');
    const { json } = require('express');
    const http = require('node:http');
    const service = make();
    class TestModule {}
    Reflect.defineMetadata('design:paramtypes', [RenewalService], RenewalController);
    NestModule({ controllers: [RenewalController], providers: [{ provide: RenewalService, useValue: service }] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false });
    const mainSource = fs.readFileSync(require('node:path').join(__dirname, '../src/main.ts'), 'utf8');
    assert.ok(mainSource.indexOf("app.use('/api/subscription-page/renewal', json(") < mainSource.indexOf('app.use(noRobotsMiddleware'));
    app.use('/' + RENEWAL_ROUTE, json({ limit: '16kb', strict: true }));
    app.use(headerFilterMiddleware);
    app.setGlobalPrefix('synthetic-prefix', { exclude: [RENEWAL_ROUTE] });
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());
    const fetch = t.mock.method(global, 'fetch', async (_, init) => {
        assert.deepEqual(JSON.parse(init.body), { action: 'options', short_uuid: 'synthetic-link' });
        return new Response(JSON.stringify({ available: true }));
    });
    const post = body => new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port: app.getHttpServer().address().port,
            path: '/' + RENEWAL_ROUTE, method: 'POST', headers: {
                'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Synthetic-Test', Origin: config.SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN,
                'X-Subscription-Renewal': service.pageToken('synthetic-link')
            }
        }, response => {
            let data = ''; response.on('data', chunk => { data += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data }));
        });
        request.on('error', reject); request.end(body);
    });
    const response = await post(JSON.stringify({ action: 'options' }));
    assert.equal(response.status, 201);
    assert.equal(response.headers['cache-control'], 'no-store, private');
    assert.deepEqual(JSON.parse(response.data), { available: true });
    assert.equal((await post('[')).status, 400);
    assert.equal((await post(JSON.stringify({ action: 'options', oversized: 'a'.repeat(17000) }))).status, 413);
    assert.equal(fetch.mock.callCount(), 1);
});
