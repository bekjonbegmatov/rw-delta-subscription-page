import { Body, Controller, Header, HttpException, Injectable, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { TypedConfigService } from '@common/config/app-config';

export const RENEWAL_ROUTE = 'api/subscription-page/renewal';
const audience = 'subscription-page-renewal';

@Injectable()
export class RenewalService {
    private readonly limits = new Map<string, { count: number; until: number }>();
    constructor(private readonly config: TypedConfigService, private readonly jwt: JwtService) {}

    public pageToken(shortUuid: string): string | null {
        if (!this.config.get('SUBSCRIPTION_RENEWAL_URL')) return null;
        return this.jwt.sign({ shortUuid }, { audience, expiresIn: '2h', jwtid: randomUUID() });
    }

    public async request(req: Request, body: unknown) {
        const url = this.config.get('SUBSCRIPTION_RENEWAL_URL');
        const token = this.config.get('SUBSCRIPTION_RENEWAL_TOKEN');
        const origin = this.config.get('SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN');
        if (!url || !token || !origin) throw new HttpException('Продление не настроено.', 404);
        // Page-bound bearer, not a shared subscriber cookie: two tabs cannot switch keys.
        // Require Origin plus a custom header, so forms/cross-site requests cannot create invoices.
        // headerFilter removes content-length, so req.is() would report no body
        // even though the route's bounded JSON parser already consumed it.
        if (req.headers.origin !== origin || req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json' ||
            (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
            throw new HttpException('Запрос запрещён.', 403);
        }
        let claims: { shortUuid: string; jti: string };
        try {
            const raw = req.headers['x-subscription-renewal'];
            if (typeof raw !== 'string' || raw.length > 2048) throw new Error();
            claims = this.jwt.verify(raw, { audience, algorithms: ['HS256'] });
            if (!/^[A-Za-z0-9_-]{6,128}$/.test(claims.shortUuid) || !claims.jti) throw new Error();
        } catch {
            throw new HttpException('Сессия истекла. Обновите страницу подписки.', 401);
        }
        const now = Date.now();
        for (const [key, limit] of this.limits) if (limit.until <= now) this.limits.delete(key);
        const limit = this.limits.get(claims.jti) ?? { count: 0, until: now + 60_000 };
        if (++limit.count > 40 || this.limits.size > 10000) throw new HttpException('Слишком много запросов. Подождите минуту.', 429);
        this.limits.set(claims.jti, limit);
        if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 12000) {
            throw new HttpException('Некорректный запрос.', 400);
        }
        const payload = body as Record<string, unknown>;
        if (!['options', 'checkout', 'status'].includes(String(payload.action)) ||
            Object.keys(payload).some(key => !['action', 'quote', 'method', 'request_key', 'order_id'].includes(key))) {
            throw new HttpException('Некорректный запрос.', 400);
        }
        try {
            // Fixed configured private URL; no caller-selected hosts, forwarded headers or redirects.
            const response = await fetch(url, {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(110_000),
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, short_uuid: claims.shortUuid }),
            });
            const text = await response.text();
            if (text.length > 100_000) throw new Error();
            const data = JSON.parse(text);
            if (!response.ok) {
                const detail = typeof data.detail === 'string' ? data.detail :
                    Array.isArray(data) && typeof data[0] === 'string' ? data[0] : 'Не удалось выполнить запрос продления.';
                throw new HttpException(detail.slice(0, 500), [400, 404, 409, 429].includes(response.status) ? response.status : 503);
            }
            return data;
        } catch (error) {
            if (error instanceof HttpException) throw error;
            // Do not retry a checkout: it may already have created an invoice.
            throw new HttpException('Связь прервана. Проверьте состояние счёта — не создавайте повторную оплату.', 503);
        }
    }
}

@Controller()
export class RenewalController {
    constructor(private readonly renewal: RenewalService) {}

    @Post(RENEWAL_ROUTE)
    @Header('Cache-Control', 'no-store, private')
    @Header('Referrer-Policy', 'no-referrer')
    request(@Req() req: Request, @Body() body: unknown) {
        return this.renewal.request(req, body);
    }
}
