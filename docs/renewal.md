# Продление подписки через Delta backend

Блок «Продлить подписку» расположен после данных пользователя/срока/трафика,
перед установкой. Срок и цена из Django → способ оплаты → защищённая ссылка →
проверка платежа → новый срок. Ключ прежний. Цвета/фон/радиус — из Admin V2;
daisyUI/Tailwind используют свои префиксы, без глобального сброса Mantine.

Настройки `.env` (не добавлять секреты в Git):

```dotenv
SUBSCRIPTION_RENEWAL_URL=http://deltavpn-django:8080/internal/subscription-page/renewal/
SUBSCRIPTION_RENEWAL_TOKEN=<отдельный общий с Django токен от 32 символов>
SUBSCRIPTION_RENEWAL_PUBLIC_ORIGIN=https://go.deltavpn.me
SUBSCRIPTION_APPEARANCE_URL=https://web.deltavpn.me/api/public/subscription-page/
```

Все три параметра вместе; пустые — функция выключена. URL приватный, соединение
через Docker network `deltavpn`, без публичного reverse proxy. Не использовать
panel/Support/rules token. В Delta_VPN нужны миграции `vpn.0044`/`cabinet.0009`/`admin_api.0005`/`admin_api.0006`,
новые Django + bot + Celery worker + Beat, `SUBSCRIPTION_RENEWAL_ENCRYPTION_KEY`
и флаг методов `CabinetPaymentMethod.subscription_enabled`. До обновления всех
компонентов не включать методы. Полная инструкция: `docs/subscription-renewal.md`
в соседнем репозитории Delta_VPN.
Также нужен доступный источник оформления `SUBSCRIPTION_APPEARANCE_URL`:
без него или при ошибке загрузки блок продления скрыт (безопасное значение по умолчанию).

В студии Admin V2 есть «Показывать продление подписки». Публикация `false`
скрывает блок при открытии страницы, backend запрещает новые счета. Существующие
счета не отменяются и проверяются дальше. Иконки методов берутся из HTTPS `icon_url`
настройки способа оплаты; если картинки нет или она не загрузилась — встроенный знак.
Картинки не получают URL подписки в Referrer. Шаги показывают акцент и галочки.
«Подпись блока продления» в студии меняет «Без смены ключа» через публичный
`renewal_subtitle`: до 120 символов с эмодзи, пустая строка скрывает подпись.
Вывод только как текст; старый ответ без поля получает стандартную подпись.
Студия содержит 24 узора + пустой фон, 9 градиентов + выключение, 6 анимаций,
включая снег. Эффекты выключаются при `prefers-reduced-motion` и не блокируют клики.

## Контракт браузера

`POST /api/subscription-page/renewal`, JSON, same-origin, no-store.
`X-Subscription-Renewal` содержит JWT из server-rendered meta, audience
`subscription-page-renewal`, срок 2 часа. Привязан к одной подписке, не хранится
в local/session storage, не уходит провайдеру. Origin совпадает с env.
Произвольный `short_uuid`, `user_id`, сумма или адрес backend не принимаются.

- `{action:"options"}` → `{available,tariff_name,offers,methods,order,subscription_expires_at}`.
  Offer: `{quote,name,days,amount,currency}`; method: `{code,title,description,requires_telegram,icon_url}`.
- `{action:"checkout",quote,method,request_key:<UUID>}` → order. Quote подписан
  Django, проверяется перед счётом. Запрос не повторяется автоматически.
- `{action:"status",order_id:<UUID>}` → order только для текущей ссылки/подписки.

Order: `{id,state,paid,amount,currency,days,method,stars_amount,expires_at,
subscription_expires_at,subscription_status,pay_link}`. Статус подписки берётся из
текущего ответа панели, не устанавливается браузером в ACTIVE по факту оплаты.
Состояния заказа: `creating`, `pending`, `applying`,
`succeeded`, `uncertain`, `expired`. `paid=true` не равно `succeeded`: продление
может ещё выполняться или требовать сверки. HTTPS pay_link возвращается только
для неоплаченного pending-счёта. Валюта цены — RUB, Stars-сумма приходит отдельно.

Клиент проверяет статус каждые 4–7 секунд, не повторяет checkout при сетевой
ошибке, предлагает восстановить существующий счёт. Закрытие вкладки не отменяет
фонового продления. Возврат от провайдера не подтверждает оплату.

## Локальная проверка

```sh
cd backend
npm ci
npm run typecheck
node --test tests/*.test.cjs
npm run build
cd ../frontend
npm ci
npm test
npm run start:build
```

`/appearance-preview` — интерактивный пример без реальных платежей; финальная
кнопка лишь показывает успех. Production preview требует существующий
`SUBSCRIPTION_PREVIEW_ORIGIN`; локальный vite preview может работать без backend.
Реальные провайдеры и VPN-панель в unit/browser preview не проверяются.
