import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { getJWTConfig } from '@common/config/jwt/jwt.config';

import { WebpageController } from './webpage.controller';
import { WebpageService } from './webpage.service';
import { RenewalController, RenewalService } from './renewal.service';

@Module({
    imports: [JwtModule.registerAsync(getJWTConfig())],
    controllers: [WebpageController, RenewalController],
    providers: [WebpageService, RenewalService],
    exports: [WebpageService],
})
export class WebpageModule {}
