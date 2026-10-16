import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { appearanceSchema, defaultAppearance, themeVariables, type Announcement } from './contract'
import './appearance.css'

export const isAppearancePreview = window.location.pathname === '/appearance-preview'
const Context = createContext({ config: defaultAppearance, run: 0 })

export function AppearanceProvider({ children }: { children: ReactNode }) {
    const [config, setConfig] = useState(defaultAppearance)
    const [run, setRun] = useState(0)
    useLayoutEffect(() => {
        const root = document.documentElement
        root.classList.add('subscription-themed')
        for (const [key, value] of Object.entries(themeVariables(config.theme))) root.style.setProperty(key, value)
    }, [config.theme])
    useEffect(() => {
        if (isAppearancePreview) {
            const configured = document.querySelector<HTMLMetaElement>('meta[name="subscription-preview-origin"]')?.content
            let origin = configured || ''
            if (import.meta.env.DEV && !origin && document.referrer) origin = new URL(document.referrer).origin
            if (!origin || window.parent === window) return
            const receive = (event: MessageEvent) => {
                if (event.source !== window.parent || event.origin !== origin || event.data?.type !== 'delta-appearance-preview') return
                const parsed = appearanceSchema.safeParse(event.data.config)
                if (parsed.success) {
                    setConfig(parsed.data)
                    if (Number.isSafeInteger(event.data.run)) setRun(event.data.run)
                }
            }
            window.addEventListener('message', receive)
            window.parent.postMessage({ type: 'delta-appearance-ready' }, origin)
            return () => window.removeEventListener('message', receive)
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        fetch('/api/subscription-page/appearance', { credentials: 'omit', cache: 'no-store', signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error('Appearance unavailable')
                const parsed = appearanceSchema.safeParse(await response.json())
                if (parsed.success && !controller.signal.aborted) setConfig(parsed.data)
            })
            .catch(() => { /* Built-in presentation remains usable; no stale alerts. */ })
            .finally(() => clearTimeout(timeout))
        return () => { controller.abort(); clearTimeout(timeout) }
    }, [])
    return <Context.Provider value={{ config, run }}>{children}</Context.Provider>
}

export const useAppearance = () => useContext(Context).config

function Banner({ alert }: { alert: Announcement }) {
    const [visible, setVisible] = useState(true)
    useEffect(() => {
        if (!alert.timeout_seconds) return
        const timer = setTimeout(() => setVisible(false), alert.timeout_seconds * 1000)
        return () => clearTimeout(timer)
    }, [alert.timeout_seconds])
    if (!visible) return null
    return <div className="sp-alert" data-kind={alert.type} role={alert.type === 'danger' ? 'alert' : 'status'}>
        <span className="sp-alert-icon" aria-hidden="true">{{ info: 'i', success: '✓', warning: '!', danger: '!' }[alert.type]}</span>
        <div>{alert.title && <strong>{alert.title}</strong>}<p>{alert.message}</p></div>
        {alert.dismissible && <button type="button" onClick={() => setVisible(false)} aria-label="Закрыть уведомление">×</button>}
    </div>
}

export function SubscriptionAnnouncements() {
    const { config, run } = useContext(Context)
    return <aside className="sp-alerts" aria-label="Уведомления сервиса">
        {config.alerts.filter(alert => alert.enabled).map(alert =>
            <Banner key={`${run}-${JSON.stringify(alert)}`} alert={alert} />)}
    </aside>
}
