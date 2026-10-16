import { Request, Response } from 'express';

import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { AxiosService } from '@common/axios/axios.service';
import { TypedConfigService } from '@common/config/app-config';
import { fetchExtraRules, mergeExtras, responseFormat, verifiedStatus } from './extras';

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(private readonly axiosService: AxiosService, private readonly config: TypedConfigService) {}

    public async serveSubscriptionPage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscription(
                clientIp,
                shortUuid,
                req.headers,
                !!clientType,
                clientType,
            );

            if (!subscriptionDataResponse) {
                res.socket?.destroy();
                return;
            }

            if (subscriptionDataResponse.headers) {
                res.set(subscriptionDataResponse.headers);
            }

            const rulesUrl = this.config.get('SUBSCRIPTION_RULES_URL');
            const rulesToken = this.config.get('SUBSCRIPTION_RULES_TOKEN');
            if (rulesUrl && rulesToken && subscriptionDataResponse.status === 200
                && responseFormat(subscriptionDataResponse.subscription, subscriptionDataResponse.headers, clientType)) {
                try {
                    const rules = await fetchExtraRules(rulesUrl, rulesToken);
                    if (rules.rules.some(rule => rule.enabled)) {
                        const access = await this.axiosService.getExtraAccess(clientIp, shortUuid, req.headers);
                        const status = verifiedStatus(access, shortUuid);
                        if (!status) this.logger.warn('Additional connections: access proof invalid or denied; preserving panel response.');
                        const merged = status && mergeExtras(subscriptionDataResponse.subscription,
                            subscriptionDataResponse.headers, rules, status, clientType);
                        if (merged) {
                            for (const header of ['content-length', 'content-encoding', 'etag', 'last-modified', 'content-md5', 'digest']) res.removeHeader(header);
                            res.set(merged.headers);
                            res.status(200).send(merged.body);
                            return;
                        }
                    }
                } catch {
                    // Never log keys, request URLs, response bodies or axios error objects.
                    this.logger.warn('Additional connections unavailable; preserving panel response.');
                }
            }

            res.status(200).send(subscriptionDataResponse.subscription);
            return;
        } catch (error) {
            this.logger.error('Error in serveSubscriptionPage', error);

            res.socket?.destroy();
            return;
        }
    }
}
