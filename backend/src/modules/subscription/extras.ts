import axios from 'axios';
import { z } from 'zod';

const statuses = z.enum(['ACTIVE', 'EXPIRED', 'LIMITED', 'DISABLED']);
const ruleSchema = z
    .object({
        id: z.uuid(),
        name: z.string().max(100),
        enabled: z.boolean(),
        statuses: z.array(statuses).min(1).max(4),
        mode: z.enum(['append', 'replace']),
        format: z.enum(['vless', 'xray_json']),
        content: z.string().min(1).max(65536),
    })
    .strict();
export const rulesSchema = z
    .object({
        schema_version: z.literal(1),
        revision: z.number().int().nonnegative(),
        rules: z.array(ruleSchema).max(100),
    })
    .strict();
export type ExtraRules = z.infer<typeof rulesSchema>;
export type UserStatus = z.infer<typeof statuses>;

export async function fetchExtraRules(url: string, token: string): Promise<ExtraRules> {
    // Separate client: no panel token, customer headers or cookies leave this service.
    const response = await axios.get(url, {
        timeout: 3000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        proxy: false,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return rulesSchema.parse(response.data);
}

const accessSchema = z.object({
    response: z.object({
        user: z.object({ shortUuid: z.string(), status: statuses }),
        convertedUserInfo: z.object({
            hwidCheckup: z
                .object({
                    subscriptionAllowed: z.boolean(),
                    maxDeviceReached: z.boolean(),
                    hwidNotSupported: z.boolean(),
                    limitBypassed: z.boolean(),
                })
                .nullable(),
        }),
        headers: z.record(z.string(), z.string().optional()),
    }),
});

export function deniedHeaders(headers: Record<string, unknown>): boolean {
    return Object.entries(headers).some(
        ([key, value]) =>
            ['x-hwid-limit', 'x-hwid-not-supported', 'x-hwid-max-devices-reached'].includes(
                key.toLowerCase(),
            ) &&
            String(value).toLowerCase() !== 'false' &&
            String(value) !== '0',
    );
}

export function verifiedStatus(data: unknown, shortUuid: string): UserStatus | null {
    const parsed = accessSchema.safeParse(data);
    if (!parsed.success) return null; // Older/unknown panel contracts fail closed.
    const { user, convertedUserInfo, headers } = parsed.data.response;
    const check = convertedUserInfo.hwidCheckup;
    if (
        user.shortUuid !== shortUuid ||
        deniedHeaders(headers) ||
        (check && (!check.subscriptionAllowed || check.maxDeviceReached || check.hwidNotSupported))
    )
        return null;
    return user.status;
}

type Profile = Record<string, unknown> & { outbounds: Record<string, unknown>[] };
function profiles(value: unknown, allowEmpty = false): Profile[] {
    const array = Array.isArray(value) ? value : [value];
    if (
        (!allowEmpty && !array.length) ||
        array.length > 10000 ||
        !array.every(
            (item) =>
                item &&
                typeof item === 'object' &&
                Array.isArray(item.outbounds) &&
                item.outbounds.length &&
                item.outbounds.every(
                    (out: unknown) =>
                        out &&
                        typeof out === 'object' &&
                        'protocol' in out &&
                        typeof out.protocol === 'string',
                ),
        )
    ) {
        throw new Error('Unsupported profile');
    }
    return array;
}

export function vlessProfile(line: string): Profile {
    const url = new URL(line);
    const p = Object.fromEntries(url.searchParams);
    const known = [
        'encryption',
        'flow',
        'type',
        'security',
        'sni',
        'fp',
        'pbk',
        'sid',
        'spx',
        'alpn',
        'path',
        'host',
        'serviceName',
        'mode',
        'headerType',
    ];
    if (
        url.protocol !== 'vless:' ||
        !url.hostname ||
        !url.port ||
        Number(url.port) > 65535 ||
        Number(url.port) < 1 ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(url.username) ||
        url.password ||
        (url.pathname && url.pathname !== '/') ||
        /[\s\x00-\x1f]|%(?![0-9a-fA-F]{2})/.test(line) ||
        /[\x00-\x1f]/.test(decodeURIComponent(url.hash.slice(1))) ||
        [...url.searchParams].length !== Object.keys(p).length ||
        Object.keys(p).some((key) => !known.includes(key))
    )
        throw new Error('Unsupported VLESS');
    const network = p.type || 'tcp',
        security = p.security || 'none';
    if (
        !['tcp', 'raw', 'ws', 'grpc'].includes(network) ||
        !['none', 'tls', 'reality'].includes(security) ||
        (p.encryption && p.encryption !== 'none') ||
        (p.headerType && p.headerType !== 'none') ||
        !['', 'xtls-rprx-vision'].includes(p.flow || '') ||
        (p.flow && (!['tcp', 'raw'].includes(network) || security === 'none')) ||
        !['gun', 'multi'].includes(p.mode || 'gun')
    )
        throw new Error('Unsupported VLESS');
    if (
        (network !== 'ws' && ['path', 'host'].some((key) => key in p)) ||
        (network !== 'grpc' && ['serviceName', 'mode'].some((key) => key in p)) ||
        (security !== 'reality' && ['pbk', 'sid', 'spx'].some((key) => key in p)) ||
        (security !== 'tls' && 'alpn' in p) ||
        (security === 'none' && ['sni', 'fp'].some((key) => key in p))
    )
        throw new Error('Incompatible VLESS parameters');
    const streamSettings: Record<string, unknown> = {
        network: network === 'raw' ? 'tcp' : network,
        security,
    };
    if (security === 'reality') {
        if (
            network === 'ws' ||
            !p.sni ||
            !/^[A-Za-z0-9_-]{43}$/.test(p.pbk || '') ||
            !/^(?:[a-f0-9]{2}){0,8}$/i.test(p.sid || '')
        )
            throw new Error('Invalid Reality');
        streamSettings.realitySettings = {
            serverName: p.sni,
            fingerprint: p.fp || 'chrome',
            publicKey: p.pbk,
            shortId: p.sid || '',
            spiderX: p.spx || '',
        };
    } else if (security === 'tls') {
        streamSettings.tlsSettings = {
            serverName: p.sni || url.hostname,
            fingerprint: p.fp || 'chrome',
            ...(p.alpn ? { alpn: p.alpn.split(',') } : {}),
        };
    }
    if (network === 'ws')
        streamSettings.wsSettings = {
            path: p.path || '/',
            ...(p.host ? { headers: { Host: p.host } } : {}),
        };
    if (network === 'grpc')
        streamSettings.grpcSettings = {
            serviceName: p.serviceName || '',
            multiMode: p.mode === 'multi',
        };
    return {
        remarks: decodeURIComponent(url.hash.slice(1)) || 'Дополнительное подключение',
        inbounds: [
            {
                tag: 'socks',
                listen: '127.0.0.1',
                port: 10808,
                protocol: 'socks',
                settings: { auth: 'noauth', udp: true },
            },
        ],
        outbounds: [
            {
                tag: 'proxy',
                protocol: 'vless',
                settings: {
                    vnext: [
                        {
                            address: url.hostname.replace(/^\[|\]$/g, ''),
                            port: Number(url.port),
                            users: [
                                {
                                    id: url.username,
                                    encryption: 'none',
                                    ...(p.flow ? { flow: p.flow } : {}),
                                },
                            ],
                        },
                    ],
                },
                streamSettings,
            },
        ],
    };
}

const uriLines = (text: string) =>
    text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
const validPanelLines = (lines: string[]) =>
    lines.length > 0 &&
    lines.every((line) =>
        /^(vless|vmess|trojan|ss|ssr|hysteria2?|hy2|tuic|wireguard):\/\/[^\s]+$/.test(line),
    );

export function responseFormat(
    body: Buffer,
    headers: Record<string, unknown>,
    clientType?: string,
): 'plain' | 'base64' | 'json' | null {
    if (clientType && !['json', 'v2ray-json'].includes(clientType)) return null;
    if (body.length > 8 * 1024 * 1024 || deniedHeaders(headers)) return null;
    const contentType = String(headers['content-type'] || '').toLowerCase();
    if (
        contentType.includes('html') ||
        contentType.includes('yaml') ||
        contentType.includes('octet-stream')
    )
        return null;
    const value = body.toString('utf8').trim();
    if (value.startsWith('{') || value.startsWith('[')) {
        try {
            profiles(JSON.parse(value), true);
            return 'json';
        } catch {
            return null;
        }
    }
    if (clientType) return null;
    if (validPanelLines(uriLines(value))) return 'plain';
    if (!value && contentType.includes('text/plain')) return 'base64';
    if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value)) return null;
    const compact = value.replace(/[\r\n]/g, '');
    const decoded = Buffer.from(compact, 'base64');
    if (decoded.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null;
    return validPanelLines(uriLines(decoded.toString('utf8'))) ? 'base64' : null;
}

export function mergeExtras(
    body: Buffer,
    headers: Record<string, unknown>,
    rules: ExtraRules,
    status: UserStatus,
    clientType?: string,
): { body: Buffer; headers: Record<string, string> } | null {
    const format = responseFormat(body, headers, clientType);
    if (!format) return null;
    const matched = rules.rules.filter(
        (rule) =>
            rule.enabled &&
            rule.statuses.includes(status) &&
            (format === 'json' || rule.format === 'vless'),
    );
    if (!matched.length) return null;
    const replace = matched.some((rule) => rule.mode === 'replace');
    try {
        let result: string;
        if (format === 'json') {
            const extra = matched.flatMap((rule) =>
                rule.format === 'vless'
                    ? uriLines(rule.content).map(vlessProfile)
                    : profiles(JSON.parse(rule.content)),
            );
            const combined = [
                ...(replace ? [] : profiles(JSON.parse(body.toString('utf8')), true)),
                ...extra,
            ];
            const unique = [
                ...new Map(combined.map((profile) => [JSON.stringify(profile), profile])).values(),
            ];
            result = JSON.stringify(unique);
        } else {
            const extra = matched.flatMap((rule) => uriLines(rule.content));
            extra.forEach(vlessProfile); // Same strict validation for URI and JSON deliveries.
            const original =
                format === 'base64'
                    ? Buffer.from(body.toString('utf8'), 'base64').toString('utf8')
                    : body.toString('utf8');
            const unique = new Map<string, string>();
            for (const line of [...(replace ? [] : uriLines(original)), ...extra]) {
                // Connection identity, not its display name. Keep the first occurrence.
                const key = line.split('#')[0];
                if (!unique.has(key)) unique.set(key, line);
            }
            result = [...unique.values()].join('\n');
            if (format === 'base64') result = Buffer.from(result).toString('base64');
        }
        if (!result || Buffer.byteLength(result) > 8 * 1024 * 1024) return null;
        return {
            body: Buffer.from(result),
            headers: {
                'content-type':
                    format === 'json'
                        ? 'application/json; charset=utf-8'
                        : 'text/plain; charset=utf-8',
                'cache-control': 'no-store, private',
            },
        };
    } catch {
        // Invalid additions must not corrupt or replace the panel's working response.
        return null;
    }
}
