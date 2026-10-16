/**
 * Admission is lossless; conversion is deliberately fail-closed on unmapped fields.
 * Sources: XTLS/Xray-core discussion #716, current infra/conf transport schemas,
 * v2rayN VMess share-link wiki and Shadowsocks SIP002. No URLs are fetched here.
 */
export type Profile = Record<string, unknown> & { outbounds: Record<string, unknown>[] };
const schemes = new Set([
    'vless',
    'vmess',
    'trojan',
    'ss',
    'ssr',
    'hysteria',
    'hysteria2',
    'hy2',
    'tuic',
    'wireguard',
    'wg',
    'socks',
    'socks5',
    'socks5h',
    'http',
    'https',
    'anytls',
    'ssh',
    'naive+https',
]);
const defaultPorts: Record<string, number> = {
    trojan: 443,
    hysteria: 443,
    hysteria2: 443,
    hy2: 443,
    https: 443,
    http: 80,
    socks: 1080,
    socks5: 1080,
    socks5h: 1080,
    ssh: 22,
    anytls: 443,
    'naive+https': 443,
};
const control = /[\x00-\x1f\x7f]/;
const fail = (): never => {
    throw new Error('Unsupported or malformed proxy URI');
};
function decode64(value: string): string {
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return fail();
    const raw = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.toString('base64').replace(/=+$/, '') !== raw) return fail();
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}
function endpoint(url: URL, scheme: string) {
    const port = Number(url.port || defaultPorts[scheme]);
    const bareProxy =
        ['socks', 'socks5', 'socks5h'].includes(scheme) ||
        (['http', 'https'].includes(scheme) && ['', '/'].includes(url.pathname));
    if (
        !url.hostname ||
        (!url.username && !bareProxy) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
    )
        fail();
    return { address: url.hostname.replace(/^\[|\]$/g, ''), port };
}
function ssParts(body: string) {
    let url = new URL(body);
    if (!url.username) url = new URL('ss://' + decode64(body.slice(5).split('?')[0]));
    const server = endpoint(url, 'ss');
    let credentials = decodeURIComponent(url.username + (url.password ? ':' + url.password : ''));
    if (!credentials.includes(':')) credentials = decode64(credentials);
    const index = credentials.indexOf(':');
    if (index < 1 || index === credentials.length - 1) fail();
    return {
        ...server,
        method: credentials.slice(0, index),
        password: credentials.slice(index + 1),
    };
}
function vmessObject(body: string): Record<string, unknown> {
    const obj = JSON.parse(decode64(body.slice(8)));
    if (
        !obj ||
        typeof obj !== 'object' ||
        Array.isArray(obj) ||
        typeof obj.add !== 'string' ||
        !obj.add ||
        typeof obj.id !== 'string' ||
        !obj.id ||
        !/^\d+$/.test(String(obj.port)) ||
        Number(obj.port) < 1 ||
        Number(obj.port) > 65535
    )
        fail();
    return obj;
}
export function normalizeUri(value: string): string {
    const line = value.trim(),
        hash = line.indexOf('#');
    const body = hash < 0 ? line : line.slice(0, hash);
    if (
        !body ||
        /\s/.test(body) ||
        control.test(line) ||
        /%(?![0-9a-fA-F]{2})/.test(line) ||
        control.test(decodeURIComponent(line))
    )
        return fail();
    const scheme = body.split('://')[0];
    if (!schemes.has(scheme)) return fail();
    const url = new URL(body);
    if (
        ['http', 'https'].includes(scheme) &&
        !url.username &&
        !/^https?:\/\/[^/?#]*:\d+(?:[/?]|$)/.test(body)
    )
        fail();
    if (scheme === 'vmess' && !url.username) vmessObject(body);
    else if (scheme === 'ssr') {
        if (decode64(body.slice(6)).split('/?')[0].split(':').length < 6) fail();
    } else if (scheme === 'ss') ssParts(body);
    else endpoint(url, scheme);
    return (
        body + (hash < 0 ? '' : '#' + encodeURIComponent(decodeURIComponent(line.slice(hash + 1))))
    );
}
export const uriLines = (text: string) =>
    text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

// Do not use URLSearchParams: an unescaped '+' is literal in share links, not form data.
class Params {
    values = new Map<string, string>();
    used = new Set<string>();
    constructor(query: string) {
        for (const part of query.replace(/^\?/, '').split('&').filter(Boolean)) {
            const index = part.indexOf('=');
            const key = decodeURIComponent(index < 0 ? part : part.slice(0, index));
            if (this.values.has(key)) fail();
            this.values.set(key, decodeURIComponent(index < 0 ? '' : part.slice(index + 1)));
        }
    }
    take(key: string, fallback = '') {
        this.used.add(key);
        return this.values.get(key) ?? fallback;
    }
    alias(keys: string[], fallback = '') {
        const present = keys.filter((key) => this.values.has(key));
        const values = present.map((key) => this.take(key));
        if (new Set(values).size > 1) fail();
        return values[0] ?? fallback;
    }
    done() {
        if ([...this.values.keys()].some((key) => !this.used.has(key))) fail();
    }
}
function bool(value: string): boolean {
    if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) return fail();
    return ['true', '1'].includes(value.toLowerCase());
}
function integer(value: string): number {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return fail();
    return Number(value);
}
function object(value: string): Record<string, unknown> {
    const obj = JSON.parse(value);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail();
    return obj;
}
function copy(
    p: Params,
    dest: Record<string, unknown>,
    fields: Record<string, string>,
    convert: (v: string) => unknown = (v) => v,
) {
    for (const [source, target] of Object.entries(fields))
        if (p.values.has(source)) dest[target] = convert(p.take(source));
}
function stream(p: Params, hostname: string, defaultSecurity: string): Record<string, unknown> {
    const rawNetwork = p.take('type', 'tcp');
    const network =
        (
            { raw: 'tcp', websocket: 'ws', splithttp: 'xhttp', http: 'h2', mkcp: 'kcp' } as Record<
                string,
                string
            >
        )[rawNetwork] || rawNetwork;
    const security = p.take('security', defaultSecurity);
    if (
        !['tcp', 'ws', 'grpc', 'xhttp', 'httpupgrade', 'h2', 'kcp', 'quic'].includes(network) ||
        !['none', 'tls', 'reality'].includes(security)
    )
        return fail();
    const result: Record<string, unknown> = { network, security };
    if (security === 'tls' || security === 'reality') {
        const tls: Record<string, unknown> = {
            serverName: p.alias(['sni', 'serverName'], hostname),
            fingerprint: p.alias(['fp', 'fingerprint'], 'chrome'),
        };
        if (security === 'tls') {
            copy(p, tls, { alpn: 'alpn' }, (v) => v.split(','));
            copy(p, tls, {
                pcs: 'pinnedPeerCertSha256',
                vcn: 'verifyPeerCertByName',
                ech: 'echConfigList',
                minVersion: 'minVersion',
                maxVersion: 'maxVersion',
            });
            const insecure = p.alias(['allowInsecure', 'insecure', 'skip-cert-verify']);
            // Modern Core removed allowInsecure. Do not silently change its security semantics.
            if (insecure && bool(insecure)) fail();
            result.tlsSettings = tls;
        } else {
            if (!['tcp', 'xhttp', 'grpc'].includes(network)) fail();
            const key = p.take('pbk');
            if (!/^[A-Za-z0-9_-]{43}$/.test(key)) fail();
            const sid = p.take('sid');
            if (!/^(?:[a-f0-9]{2}){0,8}$/i.test(sid)) fail();
            // publicKey remains an alias in Core; preserves compatibility with older clients.
            Object.assign(tls, { publicKey: key, shortId: sid, spiderX: p.take('spx') });
            copy(p, tls, { pqv: 'mldsa65Verify' });
            result.realitySettings = tls;
        }
    }
    if (network === 'ws' || network === 'httpupgrade' || network === 'xhttp' || network === 'h2') {
        const settings: Record<string, unknown> = { path: p.take('path', '/') };
        const host = p.take('host');
        if (host) {
            if (network === 'h2') settings.host = host.split(',');
            else if (network === 'ws') settings.headers = { Host: host };
            else settings.host = host;
        }
        if (network === 'xhttp') {
            settings.mode = p.take('mode', 'auto');
            copy(p, settings, { extra: 'extra' }, object);
        }
        // headerType=none is a widespread exporter no-op for these transports.
        if (p.take('headerType', 'none') !== 'none') fail();
        result[
            {
                ws: 'wsSettings',
                httpupgrade: 'httpupgradeSettings',
                xhttp: 'xhttpSettings',
                h2: 'httpSettings',
            }[network]!
        ] = settings;
    } else if (network === 'grpc') {
        const mode = p.take('mode', 'gun');
        if (!['gun', 'multi'].includes(mode) || p.take('headerType', 'none') !== 'none') fail();
        const settings: Record<string, unknown> = {
            serviceName: p.take('serviceName'),
            multiMode: mode === 'multi',
        };
        copy(p, settings, { authority: 'authority', user_agent: 'user_agent' });
        copy(
            p,
            settings,
            {
                idle_timeout: 'idle_timeout',
                health_check_timeout: 'health_check_timeout',
                initial_windows_size: 'initial_windows_size',
            },
            integer,
        );
        copy(p, settings, { permit_without_stream: 'permit_without_stream' }, bool);
        result.grpcSettings = settings;
    } else {
        const headerType = p.take('headerType', 'none');
        const settings: Record<string, unknown> = { header: { type: headerType } };
        if (network === 'tcp') {
            if (!['none', 'http'].includes(headerType)) fail();
            if (headerType === 'http') {
                const request: Record<string, unknown> = {};
                copy(p, request, { path: 'path' }, (v) => v.split(','));
                const host = p.take('host');
                if (host) request.headers = { Host: host.split(',') };
                settings.header = { type: 'http', request };
            }
            result.tcpSettings = settings;
        } else if (network === 'kcp') {
            copy(p, settings, { seed: 'seed' });
            copy(
                p,
                settings,
                {
                    mtu: 'mtu',
                    tti: 'tti',
                    uplinkCapacity: 'uplinkCapacity',
                    downlinkCapacity: 'downlinkCapacity',
                    readBufferSize: 'readBufferSize',
                    writeBufferSize: 'writeBufferSize',
                },
                integer,
            );
            copy(p, settings, { congestion: 'congestion' }, bool);
            result.kcpSettings = settings;
        } else {
            settings.security = p.take('quicSecurity', 'none');
            settings.key = p.take('key');
            result.quicSettings = settings;
        }
    }
    copy(p, result, { fm: 'finalmask' }, object);
    return result;
}
function wrap(
    protocol: string,
    settings: Record<string, unknown>,
    streamSettings: Record<string, unknown>,
    remarks: string,
): Profile {
    return {
        remarks: remarks || 'Дополнительное подключение',
        inbounds: [
            {
                tag: 'socks',
                listen: '127.0.0.1',
                port: 10808,
                protocol: 'socks',
                settings: { auth: 'noauth', udp: true },
            },
        ],
        outbounds: [{ tag: 'proxy', protocol, settings, streamSettings }],
    };
}
function legacyVmess(body: string): Profile {
    const obj = vmessObject(body),
        used = new Set([
            'v',
            'ps',
            'add',
            'port',
            'id',
            'aid',
            'scy',
            'net',
            'type',
            'host',
            'path',
            'tls',
        ]);
    if (obj.v !== undefined && !['1', '2'].includes(String(obj.v))) fail();
    const network = String(obj.net || 'tcp');
    const params = new Params('');
    const set = (k: string, v: unknown) => {
        if (v !== undefined && v !== '') params.values.set(k, String(v));
    };
    set('type', network);
    set('security', obj.tls || 'none');
    for (const key of ['sni', 'alpn', 'fp', 'insecure', 'allowInsecure', 'pcs', 'vcn', 'ech']) {
        used.add(key);
        set(key, obj[key]);
    }
    if (network === 'grpc') {
        set('serviceName', obj.path);
        set('mode', obj.type || 'gun');
        if (obj.host) fail(); // ambiguous legacy grpc host; do not drop it
    } else if (['kcp', 'mkcp'].includes(network)) {
        set('seed', obj.path);
        set('headerType', obj.type);
        if (obj.host) fail();
    } else if (network === 'quic') {
        set('quicSecurity', obj.host);
        set('key', obj.path);
        set('headerType', obj.type);
    } else {
        set('path', obj.path);
        set('host', obj.host);
        set('headerType', obj.type);
    }
    if (Object.keys(obj).some((k) => !used.has(k))) fail();
    const settings = {
        vnext: [
            {
                address: obj.add,
                port: Number(obj.port),
                users: [
                    {
                        id: obj.id,
                        alterId: integer(String(obj.aid ?? '0')),
                        security: String(obj.scy || 'auto'),
                    },
                ],
            },
        ],
    };
    const transport = stream(params, String(obj.add), 'none');
    params.done();
    return wrap('vmess', settings, transport, String(obj.ps || ''));
}
export function proxyProfile(value: string): Profile {
    const normalized = normalizeUri(value);
    const body = normalized.split('#')[0],
        url = new URL(normalized);
    const scheme = url.protocol.slice(0, -1);
    if (scheme === 'vmess' && !url.username) {
        const profile = legacyVmess(body);
        if (url.hash) profile.remarks = decodeURIComponent(url.hash.slice(1));
        return profile;
    }
    const p = new Params(url.search),
        remarks = decodeURIComponent(url.hash.slice(1));
    if (scheme === 'ss') {
        p.done(); // SIP003 plugins cannot be represented by native Xray Shadowsocks.
        return wrap(
            'shadowsocks',
            { servers: [ssParts(body)] },
            { network: 'tcp', security: 'none' },
            remarks,
        );
    }
    if (
        !['vless', 'vmess', 'trojan', 'socks', 'socks5', 'socks5h', 'http', 'https'].includes(
            scheme,
        )
    )
        return fail();
    if (
        (url.pathname && url.pathname !== '/') ||
        (url.password && ['vless', 'vmess', 'trojan'].includes(scheme))
    )
        fail();
    const server = endpoint(url, scheme),
        credential = decodeURIComponent(url.username);
    let protocol = scheme,
        settings: Record<string, unknown>;
    if (scheme === 'vless' || scheme === 'vmess') {
        const user: Record<string, unknown> = { id: credential };
        if (scheme === 'vless') {
            user.encryption = p.take('encryption', 'none');
            const flow = p.take('flow');
            if (flow) user.flow = flow;
        } else user.security = p.take('encryption', 'auto');
        settings = { vnext: [{ ...server, users: [user] }] };
    } else if (scheme === 'trojan') settings = { servers: [{ ...server, password: credential }] };
    else {
        protocol = ['socks', 'socks5', 'socks5h'].includes(scheme) ? 'socks' : 'http';
        settings = {
            servers: [
                {
                    ...server,
                    ...(credential
                        ? { users: [{ user: credential, pass: decodeURIComponent(url.password) }] }
                        : {}),
                },
            ],
        };
    }
    const transport = stream(
        p,
        server.address,
        ['trojan', 'https'].includes(scheme) ? 'tls' : 'none',
    );
    p.done(); // Unknown parameters remain available in URI subscriptions, never silently disappear in JSON.
    return wrap(protocol, settings, transport, remarks);
}
