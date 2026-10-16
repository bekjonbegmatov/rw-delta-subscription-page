import { Get, Controller, Header, Res } from '@nestjs/common';
import type { Response } from 'express';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import type { IJwtPayload } from '@common/constants';
import { GetJWTPayload } from '@common/decorators/get-jwt-payload';

import { WebpageService } from './webpage.service';

@Controller()
export class WebpageController {
    constructor(private readonly webpageService: WebpageService) {}

    @Get('api/subscription-page/appearance')
    @Header('Cache-Control', 'no-store')
    async getAppearance() {
        return this.webpageService.getAppearance();
    }

    @Get('appearance-preview')
    async preview(@Res() response: Response) {
        return this.webpageService.serveAppearancePreview(response);
    }

    @Get(APP_CONFIG_ROUTE_WO_LEADING_PATH)
    async getSubscriptionPageConfig(@GetJWTPayload() user: IJwtPayload) {
        return await this.webpageService.getSubscriptionPageConfig(user.su);
    }
}
