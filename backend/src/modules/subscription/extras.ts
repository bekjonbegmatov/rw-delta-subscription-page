import axios from 'axios';
import { z } from 'zod';

import { normalizeUri, proxyProfile, uriLines } from './proxy-uri';

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
                        typeof out.protocol === 'string' &&
                        out.protocol.length > 0,
                ),
        )
    ) {
        throw new Error('Unsupported profile');
    }
    return array;
}

// Legacy export retained for callers; now accepts all convertible proxy protocols.
export { proxyProfile as vlessProfile } from './proxy-uri';
const validPanelLines = (lines: string[]) =>
    lines.length > 0 &&
    lines.every((line) => {
        try {
            normalizeUri(line);
            return true;
        } catch {
            return false;
        }
    });

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
    try {
        // Atomic per rule: a partial conversion must never activate replace.
        // One incompatible rule cannot suppress other valid additions.
        const applicable = matched.flatMap((rule) => {
            try {
                const items =
                    format === 'json'
                        ? rule.format === 'vless'
                            ? uriLines(rule.content).map(proxyProfile)
                            : profiles(JSON.parse(rule.content))
                        : uriLines(rule.content).map(normalizeUri);
                return items.length ? [{ rule, items }] : [];
            } catch {
                return [];
            }
        });
        if (!applicable.length) return null;
        const replace = applicable.some(({ rule }) => rule.mode === 'replace');
        let result: string;
        if (format === 'json') {
            const extra = applicable.flatMap(({ items }) => items as Profile[]);
            const combined = [
                ...(replace ? [] : profiles(JSON.parse(body.toString('utf8')), true)),
                ...extra,
            ];
            const unique = [
                ...new Map(combined.map((profile) => [JSON.stringify(profile), profile])).values(),
            ];
            result = JSON.stringify(unique);
        } else {
            const extra = applicable.flatMap(({ items }) => items as string[]);
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
