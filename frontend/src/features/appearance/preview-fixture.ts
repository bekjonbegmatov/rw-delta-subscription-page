import { SubscriptionPageRawConfigSchema } from '@remnawave/subscription-page-types'
import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract'

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7z"/><path d="m8 12 3 3 5-6"/></svg>'
const steps = [
    ['Установите приложение', 'Выберите удобный VPN-клиент для своего устройства.'],
    ['Добавьте подписку', 'Откройте приложение и импортируйте вашу ссылку подключения.'],
    ['Подключайтесь', 'Выберите сервер и включите защищённое соединение.'],
]
const platform = (name: string) => ({
    displayName: { ru: name }, svgIconKey: 'Shield',
    apps: ['Happ', 'Hiddify'].map((name, i) => ({
        name, featured: i === 0, svgIconKey: 'Shield',
        blocks: steps.map(([title, description], j) => ({
            svgIconKey: 'Shield', svgIconColor: j === 1 ? 'violet' : 'cyan',
            title: { ru: title }, description: { ru: description }, buttons: [],
        })),
    })),
})
export const previewConfig = SubscriptionPageRawConfigSchema.parse({
    version: '1', locales: ['ru'],
    brandingSettings: { title: 'DELTA VPN', logoUrl: '', supportUrl: 'https://example.invalid/support' },
    uiConfig: { subscriptionInfoBlockType: 'expanded', installationGuidesBlockType: 'cards' },
    baseSettings: { metaTitle: 'Delta VPN', metaDescription: 'Предпросмотр', showConnectionKeys: false, hideGetLinkButton: true },
    baseTranslations: Object.fromEntries(Object.entries({
        installationGuideHeader: 'Быстрое подключение', connectionKeysHeader: 'Ключи подключения',
        linkCopied: 'Скопировано', linkCopiedToClipboard: 'Ссылка скопирована', getLink: 'Подключиться',
        scanQrCode: 'QR-код', scanQrCodeDescription: 'Отсканируйте код', copyLink: 'Скопировать',
        name: 'Пользователь', status: 'Подписка', active: 'Активна', inactive: 'Неактивна',
        expires: 'Действует до', bandwidth: 'Трафик', scanToImport: 'Добавить подписку',
        expiresIn: 'Осталось', expired: 'Истекла', unknown: 'Неизвестно', indefinitely: 'Бессрочно',
    }).map(([key, value]) => [key, { ru: value }])),
    svgLibrary: { Shield: icon },
    platforms: { ios: platform('iOS'), android: platform('Android'), windows: platform('Windows'), macos: platform('macOS') },
})
export const previewSubscription = GetSubscriptionInfoByShortUuidCommand.ResponseSchema.parse({
    response: {
        isFound: true, links: [], ssConfLinks: {}, subscriptionUrl: 'https://example.invalid/demo',
        user: { shortUuid: 'synthetic-preview', username: 'demo_user', daysLeft: 30, isActive: true,
            userStatus: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), trafficUsed: '24.8 GB', trafficLimit: '100 GB',
            lifetimeTrafficUsed: '24.8 GB', trafficUsedBytes: '24800000000', trafficLimitBytes: '100000000000',
            lifetimeTrafficUsedBytes: '24800000000', trafficLimitStrategy: 'MONTH' },
    },
}).response
