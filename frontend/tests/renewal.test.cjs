const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { createRoot } = require('react-dom/client');

const dom = new JSDOM('<!doctype html><head><meta name="subscription-renewal-token" content="synthetic-page-token"></head><body><div id="root"></div></body>', { url: 'https://sub.example.invalid/synthetic' });
global.window = dom.window; global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
let updated = null;
let renewalEnabled = true;
let renewalSubtitle = 'Без смены ключа';
const store = { subscription: { user: { expiresAt: new Date('2026-11-01') } }, actions: { setSubscriptionInfo: value => { updated = value; } } };
require.extensions['.css'] = () => {};
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const originalLoad = Module._load;
Module._load = function(id, parent, main) {
    if (id === '@features/appearance/provider') return { isAppearancePreview: false, useAppearance: () => ({ renewal_enabled: renewalEnabled, renewal_subtitle: renewalSubtitle }) };
    if (id === '@entities/subscription-info-store/subscription-info-store') return { useSubscriptionInfoStore: { getState: () => store } };
    return originalLoad.call(this, id, parent, main);
};
const { SubscriptionRenewal } = require('../src/features/renewal/renewal.tsx');
Module._load = originalLoad;

const options = {
    available: true, tariff_name: 'Synthetic', offers: [{ quote: 'signed-quote', name: 'Standard', days: 30, amount: '300', currency: 'RUB' }],
    methods: [{ code: 'platega_sbp', title: 'СБП', description: 'Банк', requires_telegram: false }], order: null,
    subscription_expires_at: '2026-11-01T00:00:00Z'
};
const pending = { id: 'synthetic-order', state: 'pending', paid: false, days: 30, amount: '300', method: 'platega_sbp',
    currency: 'RUB', stars_amount: null, expires_at: '2026-11-01T01:00:00Z', subscription_expires_at: null, pay_link: 'https://pay.example.invalid/invoice' };
let root;
beforeEach(async () => {
    updated = null; renewalEnabled = true; renewalSubtitle = 'Без смены ключа';
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(SubscriptionRenewal)));
});
afterEach(async () => { await React.act(async () => root.unmount()); });
const button = label => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
const click = async label => { assert.ok(button(label), `button ${label}`); await React.act(async () => button(label).click()); };
const choose = async () => {
    await click('Продлить'); await click('Выбрать оплату');
    await React.act(async () => document.querySelector('input[name="renewal-method"]').click());
};

test('custom subtitle supports emoji and treats HTML as text; blank hides it', async () => {
    assert.match(document.querySelector('.renewal-header').textContent, /Без смены ключа/);
    renewalSubtitle = '🔑 Ваш ключ <b>останется</b> прежним';
    await React.act(async () => root.render(React.createElement(SubscriptionRenewal)));
    assert.equal(document.querySelector('.renewal-header p').textContent, renewalSubtitle);
    assert.equal(document.querySelector('.renewal-header b'), null);
    renewalSubtitle = '';
    await React.act(async () => root.render(React.createElement(SubscriptionRenewal)));
    assert.equal(document.querySelector('.renewal-header p'), null);
});

test('period -> method -> invoice -> confirmed renewal; never trusts redirect or credits client-side', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const bodies = [];
    t.mock.method(global, 'fetch', async (url, init) => {
        assert.equal(url, '/api/subscription-page/renewal');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.referrerPolicy, 'no-referrer');
        assert.equal(init.headers['X-Subscription-Renewal'], 'synthetic-page-token');
        const body = JSON.parse(init.body); bodies.push(body);
        return new Response(JSON.stringify(body.action === 'options' ? options : body.action === 'checkout' ? pending : {
            ...pending, state: 'succeeded', paid: true, subscription_expires_at: '2026-12-01T00:00:00Z', subscription_status: 'LIMITED', pay_link: null
        }));
    });
    await choose();
    assert.equal(document.querySelector('[aria-current="step"]').textContent, 'Оплата — текущий шаг');
    assert.equal(document.querySelector('li[data-content="✓"]').textContent, 'Срок — завершено');
    await React.act(async () => { button('К оплате').click(); button('К оплате').click(); });
    assert.equal(bodies.filter(b => b.action === 'checkout').length, 1);
    assert.equal(bodies[1].quote, 'signed-quote');
    assert.equal(bodies[1].method, 'platega_sbp');
    assert.equal(bodies[1].amount, undefined);
    assert.equal(bodies[1].user_id, undefined);
    const link = document.querySelector('a');
    assert.equal(link.href, pending.pay_link);
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(updated, null);
    await React.act(async () => { t.mock.timers.tick(4000); });
    assert.match(document.body.textContent, /Подписка продлена!/);
    assert.equal(document.querySelectorAll('li[data-content="✓"]').length, 3);
    assert.equal(document.querySelector('[aria-current="step"]'), null);
    assert.equal(updated.subscription.user.expiresAt.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(updated.subscription.user.userStatus, 'LIMITED');
    assert.equal(updated.subscription.user.isActive, false);
});

test('checkout transport failure allows only status recovery, not another creation', async t => {
    let creates = 0;
    t.mock.method(global, 'fetch', async (_, init) => {
        const body = JSON.parse(init.body);
        if (body.action === 'checkout') { creates++; throw new Error('Связь прервана'); }
        return new Response(JSON.stringify(creates ? { ...options, order: { ...pending, state: 'uncertain', pay_link: null } } : options));
    });
    await choose(); await click('К оплате');
    assert.equal(button('К оплате'), undefined);
    await click('Проверить состояние счёта');
    assert.match(document.body.textContent, /Не оплачивайте повторно/);
    assert.equal(document.querySelector('a'), null);
    assert.equal(creates, 1);
});

test('existing pending invoice is recovered without issuing another payment', async t => {
    const fetch = t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ...options, order: pending })));
    await click('Продлить');
    assert.match(document.body.textContent, /Всё готово к оплате/);
    assert.equal(document.querySelector('a').href, pending.pay_link);
    assert.equal(fetch.mock.callCount(), 1);
});

test('unavailable methods do not offer a checkout', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ...options, methods: [] })));
    await click('Продлить');
    assert.match(document.body.textContent, /пока недоступно/);
    assert.equal(button('Выбрать оплату'), undefined);
});

test('unsafe payment URLs never become executable links', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ...options, order: { ...pending, pay_link: 'javascript:alert(1)' } })));
    await click('Продлить');
    assert.equal(document.querySelector('a'), null);
    assert.match(document.body.textContent, /Ссылка недоступна/);
});

test('master setting hides renewal before customer actions', async t => {
    const fetch = t.mock.method(global, 'fetch');
    renewalEnabled = false;
    await React.act(async () => root.render(React.createElement(SubscriptionRenewal)));
    assert.equal(document.querySelector('section'), null);
    assert.equal(fetch.mock.callCount(), 0);
});

test('method images use configured HTTPS URL, hide referrer and fall back on load error', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ...options,
        methods: [{ ...options.methods[0], icon_url: 'https://images.example.invalid/sbp.png' }] })));
    await choose();
    const image = document.querySelector('.renewal-payment-icon img');
    assert.equal(image.src, 'https://images.example.invalid/sbp.png');
    assert.equal(image.getAttribute('referrerpolicy'), 'no-referrer');
    await React.act(async () => image.dispatchEvent(new dom.window.Event('error')));
    assert.equal(document.querySelector('.renewal-payment-icon img'), null);
    assert.ok(document.querySelector('.renewal-payment-icon svg'));
});

test('unsafe method images are never requested', async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ...options,
        methods: [{ ...options.methods[0], icon_url: 'javascript:alert(1)' }] })));
    await choose();
    assert.equal(document.querySelector('.renewal-payment-icon img'), null);
});
