import { useEffect, useRef, useState } from 'react'
import { IconArrowRight, IconBrandTelegram, IconCalendarPlus, IconCheck, IconCoin, IconCreditCard, IconExternalLink, IconQrcode, IconShieldCheck, IconStar } from '@tabler/icons-react'
import { isAppearancePreview, useAppearance } from '@features/appearance/provider'
import { useSubscriptionInfoStore } from '@entities/subscription-info-store/subscription-info-store'
import './renewal.css'

type Offer = { quote: string; name: string; days: number; amount: string; currency: string }
type Method = { code: string; title: string; description: string; requires_telegram: boolean; icon_url?: string }
type Order = {
    id: string; state: 'creating' | 'pending' | 'applying' | 'succeeded' | 'uncertain' | 'expired'
    paid: boolean; amount: string; currency: string; days: number; method: string
    stars_amount: number | null; expires_at: string | null; subscription_expires_at: string | null; pay_link: string | null
    subscription_status?: 'ACTIVE' | 'EXPIRED' | 'LIMITED' | 'DISABLED' | null
}
type Options = { available: boolean; tariff_name: string; offers: Offer[]; methods: Method[]; order: Order | null; subscription_expires_at: string }

const pageToken = document.querySelector<HTMLMetaElement>('meta[name="subscription-renewal-token"]')?.content
document.querySelector('meta[name="subscription-renewal-token"]')?.remove()
const money = (value: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value))
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\.$/, '')
const period = (days: number) => `${days} ${days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && !(days % 100 >= 12 && days % 100 <= 14) ? 'дня' : 'дней'}`

const previewOptions: Options = {
    available: true, tariff_name: 'DELTA · Standard', subscription_expires_at: '2026-11-16T12:00:00Z', order: null,
    offers: [30, 90, 180].map((days, i) => ({ quote: `demo-${days}`, name: 'Standard', days, amount: String([299, 799, 1499][i]), currency: 'RUB' })),
    methods: [
        { code: 'platega_sbp', title: 'СБП', description: 'Быстрая оплата в приложении банка', requires_telegram: false },
        { code: 'platega_card', title: 'Банковская карта', description: 'Защищённая страница оплаты', requires_telegram: false },
        { code: 'cryptobot', title: 'Crypto Bot', description: 'Оплата криптовалютой в Telegram', requires_telegram: true }
    ]
}

async function api<T>(payload: object): Promise<T> {
    const response = await fetch('/api/subscription-page/renewal', {
        method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'X-Subscription-Renewal': pageToken ?? '' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(115_000)
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Не удалось связаться с сервисом продления. Проверьте состояние счёта.')
    return data
}

function safePaymentLink(value: string | null): string | undefined {
    if (!value) return undefined
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
    } catch { return undefined }
}

function PaymentIcon({ method }: { method: Method }) {
    const [failed, setFailed] = useState(false)
    useEffect(() => setFailed(false), [method.icon_url])
    const source = safePaymentLink(method.icon_url ?? null)
    const Icon = method.code.includes('sbp') ? IconQrcode : method.code.includes('card') ? IconCreditCard
        : method.code === 'TGS' ? IconStar : method.code.includes('crypto') ? IconCoin : IconBrandTelegram
    return <span className="renewal-payment-icon" aria-hidden="true">
        {source && !failed ? <img src={source} alt="" width={32} height={32} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon size={25} />}
    </span>
}

export function SubscriptionRenewal() {
    const { renewal_enabled, renewal_subtitle } = useAppearance()
    const [expanded, setExpanded] = useState(false)
    const [options, setOptions] = useState<Options | null>(null)
    const [step, setStep] = useState(1)
    const [offer, setOffer] = useState<Offer | null>(null)
    const [method, setMethod] = useState('')
    const [order, setOrder] = useState<Order | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [recoverOnly, setRecoverOnly] = useState(false)
    const inFlight = useRef(false)
    const heading = useRef<HTMLHeadingElement>(null)

    const load = async () => {
        if (inFlight.current) return
        inFlight.current = true
        setExpanded(true); setBusy(true); setError('')
        try {
            const result = isAppearancePreview ? previewOptions : await api<Options>({ action: 'options' })
            setOptions(result); setOffer(result.offers[0] ?? null); setMethod(''); setOrder(result.order)
            setStep(result.order ? 3 : 1)
            if (result.order) setRecoverOnly(false)
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить варианты продления.') }
        finally { inFlight.current = false; setBusy(false) }
    }

    useEffect(() => {
        if (expanded && !busy) heading.current?.focus({ preventScroll: true })
    }, [expanded, step]) // Do not steal focus on background payment checks.

    useEffect(() => {
        if (order?.state === 'succeeded' && order.subscription_expires_at && !isAppearancePreview) {
            const store = useSubscriptionInfoStore.getState()
            const subscription = store.subscription
            if (subscription?.user) store.actions.setSubscriptionInfo({ subscription: {
                ...subscription, user: { ...subscription.user, expiresAt: new Date(order.subscription_expires_at),
                    daysLeft: Math.max(0, Math.ceil((new Date(order.subscription_expires_at).getTime() - Date.now()) / 86400000)),
                    ...(order.subscription_status ? { isActive: order.subscription_status === 'ACTIVE', userStatus: order.subscription_status } : {}) }
            } })
        }
    }, [order?.state, order?.subscription_expires_at, order?.subscription_status])

    useEffect(() => {
        if (!order || !['creating', 'pending', 'applying', 'expired'].includes(order.state) || isAppearancePreview) return
        let stopped = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const next = await api<Order>({ action: 'status', order_id: order.id })
                if (!stopped) { setOrder(next); setError('') }
            } catch { if (!stopped) setError('Проверка временно недоступна. Не оплачивайте повторно — продолжим проверять автоматически.') }
            if (!stopped) timer = setTimeout(poll, 7000)
        }
        timer = setTimeout(poll, 4000)
        return () => { stopped = true; clearTimeout(timer) }
    }, [order?.id, order?.state])

    const create = async () => {
        if (!offer || !method || inFlight.current || recoverOnly) return
        inFlight.current = true
        setBusy(true); setError('')
        try {
            const result: Order = isAppearancePreview ? {
                id: 'preview-order', state: 'pending', paid: false, amount: offer.amount, currency: 'RUB', days: offer.days,
                method, stars_amount: null, expires_at: new Date(Date.now() + 3600000).toISOString(), subscription_expires_at: null, pay_link: null
            } : await api<Order>({ action: 'checkout', quote: offer.quote, method, request_key: crypto.randomUUID() })
            setOrder(result); setStep(3)
        } catch (cause) {
            setRecoverOnly(true)
            setError(cause instanceof Error ? cause.message : 'Результат запроса неизвестен. Проверьте состояние счёта, не оплачивайте повторно.')
        } finally { inFlight.current = false; setBusy(false) }
    }

    if ((!pageToken && !isAppearancePreview) || (!renewal_enabled && !order)) return null
    const paymentLink = safePaymentLink(order?.pay_link ?? null)
    const successful = order?.state === 'succeeded'
    return (
        <section className="subscription-renewal rw:rn-card" aria-labelledby="renewal-heading">
            <div className="rw:rn-card-body rw:gap-4 rw:p-4 rw:sm:p-5">
                <div className="renewal-header rw:flex rw:items-center rw:justify-between rw:gap-3">
                    <div className="rw:flex rw:min-w-0 rw:flex-1 rw:items-center rw:gap-3">
                        <span className="renewal-header-icon" aria-hidden="true"><IconCalendarPlus size={20} /></span>
                        <div className="rw:min-w-0">
                            <h2 id="renewal-heading" className="rw:rn-card-title rw:text-base" ref={heading} tabIndex={-1}>Продлить подписку</h2>
                            {renewal_subtitle && <p className="rw:text-xs rw:text-base-content/70 rw:wrap-anywhere">{renewal_subtitle}</p>}
                        </div>
                    </div>
                    {!expanded && <button type="button" className="rw:rn-btn rw:rn-btn-sm rw:shrink-0" onClick={() => void load()}>Продлить <IconArrowRight size={16} aria-hidden="true" /></button>}
                </div>

                {expanded && <>
                    <ul className="rw:rn-steps rw:w-full" aria-label="Этапы продления">
                        {['Срок', 'Оплата', 'Продление'].map((label, i) => <li key={label}
                            className={`rw:rn-step ${step > i ? 'rw:rn-step-accent' : ''} ${step > i + 1 || successful ? 'renewal-step-done' : ''}`}
                            data-content={step > i + 1 || successful ? '✓' : String(i + 1)}
                            aria-current={!successful && step === i + 1 ? 'step' : undefined}>
                            {label}<span className="rw:sr-only">{step > i + 1 || successful ? ' — завершено' : step === i + 1 ? ' — текущий шаг' : ' — впереди'}</span>
                        </li>)}
                    </ul>
                    {isAppearancePreview && <p className="rw:text-xs rw:text-base-content/70">Демо · без реальной оплаты</p>}
                    {error && <div className="rw:rn-alert rw:rn-alert-soft rw:rn-alert-warning" role="alert">{error}</div>}
                    {busy && <p className="rw:flex rw:items-center rw:gap-3" role="status"><span className="rw:rn-loading rw:rn-loading-spinner rw:rn-loading-sm" aria-hidden="true" />{step === 2 ? 'Создаём защищённый счёт…' : 'Загружаем данные…'}</p>}

                    {!busy && !order && recoverOnly && <div className="rw:space-y-3"><p className="rw:text-sm">Не создавайте новый платёж, пока не проверили результат предыдущего запроса.</p><button type="button" className="rw:rn-btn" onClick={() => void load()}>Проверить состояние счёта</button></div>}
                    {!busy && !options && !recoverOnly && <button type="button" className="rw:rn-btn" onClick={() => void load()}>Повторить загрузку</button>}
                    {!busy && options && !order && !recoverOnly && <>
                        {(!options.available || !options.methods.length) ? <div className="rw:rn-alert" role="status">Продление через сайт пока недоступно для этой подписки. Обратитесь в поддержку или откройте бота.</div> : <>
                            {step === 1 && <fieldset>
                                <legend>На какой срок продлить?</legend>
                                <div className="rw:grid rw:grid-cols-1 rw:gap-2 rw:sm:grid-cols-3">
                                    {options.offers.map(item => <label className="renewal-option renewal-period rw:flex rw:flex-col rw:gap-2" key={item.quote}>
                                        <span className="rw:flex rw:items-center rw:justify-between rw:gap-3"><strong>{period(item.days)}</strong><input type="radio" className="rw:rn-radio rw:rn-radio-sm" name="renewal-period" checked={offer?.quote === item.quote} onChange={() => setOffer(item)} /></span>
                                        <span className="rw:text-xl rw:font-semibold">{money(item.amount)}</span>
                                    </label>)}
                                </div>
                            </fieldset>}
                            {step === 2 && <>
                                <p className="rw:text-sm rw:text-base-content/70">{offer?.name} · {period(offer?.days ?? 0)} · <strong className="rw:text-base-content">{money(offer?.amount ?? '0')}</strong></p>
                                <fieldset><legend>Как вам удобнее оплатить?</legend>
                                    <div className="rw:grid rw:grid-cols-1 rw:gap-3 rw:sm:grid-cols-2">
                                        {options.methods.map(item => <label className="renewal-option rw:flex rw:items-center rw:gap-3" key={item.code}>
                                            <PaymentIcon method={item} />
                                            <span className="rw:flex rw:grow rw:flex-col rw:gap-1"><strong>{item.title}</strong><span className="rw:text-xs rw:text-base-content/70">{item.description}</span>{item.requires_telegram && <span className="rw:text-xs rw:text-base-content/70">В Telegram{item.code === 'TGS' ? ' · из аккаунта владельца подписки' : ''}</span>}</span>
                                            <input type="radio" className="rw:rn-radio rw:rn-radio-sm rw:shrink-0" name="renewal-method" checked={method === item.code} onChange={() => setMethod(item.code)} />
                                        </label>)}
                                    </div>
                                </fieldset>
                            </>}
                            <div className="rw:rn-card-actions rw:flex-col-reverse rw:gap-3 rw:sm:flex-row rw:sm:items-center rw:sm:justify-between">
                                <p className="rw:flex rw:items-center rw:gap-2 rw:text-xs rw:text-base-content/70"><IconShieldCheck size={17} aria-hidden="true" />Без автосписаний. Остаток срока сохраняется.</p>
                                <div className="rw:flex rw:w-full rw:gap-2 rw:sm:w-auto">
                                    {step === 2 && <button type="button" className="rw:rn-btn" onClick={() => setStep(1)}>Назад</button>}
                                    <button type="button" className="rw:rn-btn rw:grow rw:sm:grow-0" disabled={step === 1 ? !offer : !method} onClick={() => step === 1 ? setStep(2) : void create()}>{step === 1 ? 'Выбрать оплату' : 'К оплате'}<IconArrowRight size={17} aria-hidden="true" /></button>
                                </div>
                            </div>
                        </>}
                    </>}

                    {order && <div className="rw:space-y-5" aria-live="polite">
                        <div className="rw:space-y-2">
                            <h3 className="rw:flex rw:items-center rw:gap-2 rw:text-lg rw:font-semibold">{successful && <IconCheck size={23} aria-hidden="true" />}{successful ? 'Подписка продлена!' : order.state === 'uncertain' ? 'Нужна проверка оплаты' : order.state === 'expired' ? 'Срок счёта истёк' : order.state === 'applying' || order.paid ? 'Оплата получена. Продлеваем…' : order.state === 'creating' ? 'Счёт создаётся…' : 'Всё готово к оплате'}</h3>
                            <p className="rw:text-sm rw:text-base-content/70">{successful && order.subscription_expires_at ? `Новый срок: ${date(order.subscription_expires_at)}. Подписка в приложении остаётся той же.` : `${period(order.days)} · ${money(order.amount)}${order.stars_amount ? ` · ${order.stars_amount} Stars` : ''}`}</p>
                        </div>
                        {order.state === 'pending' && !order.paid && <>
                            {paymentLink ? <a className="rw:rn-btn" href={paymentLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Перейти к оплате <IconExternalLink size={17} aria-hidden="true" /></a> : isAppearancePreview ? <button type="button" className="rw:rn-btn" onClick={() => setOrder({ ...order, paid: true, state: 'succeeded', subscription_expires_at: '2026-12-16T12:00:00Z' })}>Показать успешное продление</button> : <div className="rw:rn-alert" role="status">Ссылка недоступна. Обратитесь в поддержку, не создавая повторный платёж.</div>}
                            <p className="rw:text-xs rw:text-base-content/70">После оплаты продлим автоматически. Эту страницу можно закрыть. Возможную комиссию покажет платёжный сервис.</p>
                        </>}
                        {['creating', 'applying'].includes(order.state) && <p className="rw:flex rw:items-center rw:gap-3 rw:text-sm" role="status"><span className="rw:rn-loading rw:rn-loading-spinner rw:rn-loading-sm" aria-hidden="true" />Проверяем автоматически. Повторно платить не нужно.</p>}
                        {order.state === 'uncertain' && <div className="rw:rn-alert rw:rn-alert-soft rw:rn-alert-warning" role="alert">Не оплачивайте повторно. Передайте поддержке номер счёта ниже: результат проверят без повторного продления.</div>}
                        {order.state === 'expired' && <p className="rw:text-sm">Не оплачивайте старую ссылку. Если деньги уже списаны, дождитесь подтверждения или обратитесь в поддержку.</p>}
                        <p className="rw:break-all rw:text-xs rw:text-base-content/60">Номер счёта: {order.id}</p>
                        {successful && <div className="rw:flex rw:flex-wrap rw:gap-2"><button type="button" className="rw:rn-btn" onClick={() => window.location.reload()}>Обновить данные подписки</button><button type="button" className="rw:rn-btn" onClick={() => { setOrder(null); setStep(1) }}>Продлить ещё</button></div>}
                        {order.state === 'expired' && <button type="button" className="rw:rn-btn" onClick={() => { setOrder(null); setStep(1) }}>Выбрать новое продление</button>}
                    </div>}
                </>}
            </div>
        </section>
    )
}
