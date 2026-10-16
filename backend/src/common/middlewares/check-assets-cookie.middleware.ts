import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

import { Logger } from '@nestjs/common';

import { IJwtPayload } from '@common/constants';

const logger = new Logger('CheckAssetsCookieMiddleware');

export function checkAssetsCookieMiddleware(
    req: { user: IJwtPayload } & Request,
    res: Response,
    next: NextFunction,
) {
    const secret = process.env.INTERNAL_JWT_SECRET;

    if (!secret) {
        logger.error('INTERNAL_JWT_SECRET is not set');
        res.socket?.destroy();

        return;
    }

    if (!req.cookies.session) {
        // Synthetic preview can load static files, never the protected app-config
        // route or any subscription endpoint. Its cookie is not a customer session.
        if (req.cookies.appearance_preview && /^\/[a-zA-Z0-9_./-]+\.(js|css|woff2?|ttf|svg|png|jpe?g|webp|ico)$/.test(req.path)) {
            try {
                const preview = jwt.verify(req.cookies.appearance_preview, secret);
                if (typeof preview === 'object' && preview.purpose === 'appearance-preview') {
                    next();
                    return;
                }
            } catch { /* Continue through the existing rejection path. */ }
        }
        logger.debug('No session cookie found');
        res.socket?.destroy();

        return;
    }

    try {
        const jwtPayload = jwt.verify(req.cookies.session, secret);

        req.user = jwtPayload as unknown as IJwtPayload;
    } catch (error) {
        logger.debug(error);
        res.socket?.destroy();

        return;
    }

    return next();
}
