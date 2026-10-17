import proxyaddr from 'proxy-addr';
import { z } from 'zod';

const booleanString = (def: 'true' | 'false' = 'false') =>
    z
        .string()
        .default(def)
        .transform((val) => (val === '' ? def : val))
        .refine((val) => val === 'true' || val === 'false', 'Must be "true" or "false".')
        .transform((val) => val === 'true')
        .pipe(z.boolean());

const TRUST_PROXY_DEFAULT = '1';

const isAppearanceUrl = (value: string | undefined, originOnly = false): boolean => {
    if (!value) return true;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol)
            && !url.username && !url.password
            && (!originOnly || url.origin === value);
    } catch {
        return false;
    }
};

const isTrustProxy = (val: string): boolean => {
    if (val === 'true' || val === 'false' || /^\d+$/.test(val)) return true;

    try {
        proxyaddr.compile(val.split(',').map((entry) => entry.trim()));
        return true;
    } catch {
        return false;
    }
};

const REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE =
    'Remnawave Dashboard → Remnawave Settings → API Tokens. Create a new API Token and set it in the .env file.';

export const configSchema = z
    .object({
        APP_PORT: z
            .string()
            .default('3010')
            .transform((port) => parseInt(port, 10)),
        REMNAWAVE_PANEL_URL: z.string(),
        REMNAWAVE_API_TOKEN: z
            .string({ message: REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE })
            .min(1, REQUIRED_REMNAWAVE_API_TOKEN_MESSAGE),

        SUBPAGE_CONFIG_UUID: z.string().default('00000000-0000-0000-0000-000000000000'),
        CUSTOM_SUB_PREFIX: z.optional(z.string()),
        FAVICON_PUBLIC_URL: z.string().max(2048).optional().refine(value => !value ||
            (isAppearanceUrl(value) && value.startsWith('https://')), 'Use an HTTPS favicon URL without credentials.'),
        SUBSCRIPTION_RULES_URL: z.string().optional().refine(value => isAppearanceUrl(value), 'Use an HTTP(S) internal rules URL without credentials.'),
        SUBSCRIPTION_RULES_TOKEN: z.string().optional(),
        SUBSCRIPTION_RENEWAL_URL: z.string().optional().refine(value => isAppearanceUrl(value), 'Use a private HTTP(S) renewal endpoint.'),
        SUBSCRIPTION_RENEWAL_TOKEN: z.string().optional(),
        SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN: z.string().optional().refine(value => isAppearanceUrl(value, true), 'Use the exact public subpage origin.'),
        SUBSCRIPTION_APPEARANCE_URL: z.union([z.literal(''), z.url()]).optional()
            .refine((value) => isAppearanceUrl(value),
                'Use an HTTP(S) appearance URL without credentials.'),
        SUBSCRIPTION_PREVIEW_ORIGIN: z.union([z.literal(''), z.url()]).optional()
            .refine((value) => isAppearanceUrl(value, true),
                'Use the exact Admin V2 origin without a path or trailing slash.'),

        TRUST_PROXY: z
            .string()
            .default(TRUST_PROXY_DEFAULT)
            .transform((val) => (val.trim() === '' ? TRUST_PROXY_DEFAULT : val.trim()))
            .refine(
                isTrustProxy,
                'TRUST_PROXY must be "true"/"false", a non-negative integer (number of trusted ' +
                    'reverse-proxy hops), or a comma-separated list of preset names ' +
                    '(loopback, linklocal, uniquelocal) and/or IP addresses / CIDR subnets.',
            )
            .transform((val): boolean | number | string => {
                if (val === 'true') return true;
                if (val === 'false') return false;
                if (/^\d+$/.test(val)) return Number(val);
                return val;
            }),

        CADDY_AUTH_API_TOKEN: z.optional(z.string()),
        CLOUDFLARE_ZERO_TRUST_CLIENT_ID: z.optional(z.string()),
        CLOUDFLARE_ZERO_TRUST_CLIENT_SECRET: z.optional(z.string()),

        MARZBAN_LEGACY_LINK_ENABLED: booleanString(),
        MARZBAN_LEGACY_SECRET_KEY: z.optional(z.string()),
        MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM: z.optional(z.string()),
        MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS: booleanString(),
        INTERNAL_JWT_SECRET: z.string(),
        EGAMES_COOKIE: z.optional(z.string()),
    })
    .superRefine((data, ctx) => {
        const renewal = [data.SUBSCRIPTION_RENEWAL_URL, data.SUBSCRIPTION_RENEWAL_TOKEN, data.SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN];
        if (renewal.some(Boolean) && (!renewal.every(Boolean) || data.SUBSCRIPTION_RENEWAL_TOKEN!.length < 32)) {
            ctx.addIssue({ code: 'custom', path: ['SUBSCRIPTION_RENEWAL_TOKEN'], message: 'Configure renewal URL, dedicated 32+ character token and public origin together.' });
        }
        if (Boolean(data.SUBSCRIPTION_RULES_URL) !== Boolean(data.SUBSCRIPTION_RULES_TOKEN)
            || (data.SUBSCRIPTION_RULES_TOKEN && data.SUBSCRIPTION_RULES_TOKEN.length < 32)) {
            ctx.addIssue({ code: 'custom', path: ['SUBSCRIPTION_RULES_TOKEN'], message: 'Configure both rules URL and a dedicated token of at least 32 characters.' });
        }
        if (
            !data.REMNAWAVE_PANEL_URL.startsWith('http://') &&
            !data.REMNAWAVE_PANEL_URL.startsWith('https://')
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'REMNAWAVE_PANEL_URL must start with http:// or https://',
                path: ['REMNAWAVE_PANEL_URL'],
            });
        }
        if (data.MARZBAN_LEGACY_LINK_ENABLED) {
            if (!data.MARZBAN_LEGACY_SECRET_KEY) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        'MARZBAN_LEGACY_SECRET_KEY is required when MARZBAN_LEGACY_LINK_ENABLED is true',
                });
            }
        }
    });

export type ConfigSchema = z.infer<typeof configSchema>;
