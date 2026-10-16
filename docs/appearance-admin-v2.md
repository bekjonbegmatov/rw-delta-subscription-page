# Оформление и уведомления из Delta Admin V2

Дополнительные VLESS/Xray JSON по статусу и `FAVICON_PUBLIC_URL`:
[настройка подключений и favicon](additional-connections.md).

Admin V2 содержит редактор `/admin-v2/subscription-page`: шесть пресетов, два
акцента, фон, текст, поверхности, градиенты, узоры, скругления и прозрачность.
Настройки сохраняет Django. Сервис подписки запрашивает публичный JSON при
открытии страницы через собственный `GET /api/subscription-page/appearance`.
API-токен панели и данные клиента к запросу не добавляются.

## Окружение сервиса подписки

```dotenv
SUBSCRIPTION_APPEARANCE_URL=https://delta.example.com/api/public/subscription-page/
SUBSCRIPTION_PREVIEW_ORIGIN=https://delta.example.com
```

Первое значение — фиксированный HTTP(S) URL источника, пустое оставляет стандартную
тему. Второе — точный origin Admin V2, без пути и завершающего слеша; пустое
выключает `/appearance-preview`. В Django задайте
`SUBSCRIPTION_PAGE_PREVIEW_URL=https://subscription.example.com/appearance-preview`,
а в Nginx Admin V2 — `SUBSCRIPTION_PREVIEW_FRAME_ORIGIN=https://subscription.example.com`.
Замените домены своими. Эти параметры не содержат секретов и не являются VITE_*.

В Delta_VPN нужна миграция `admin_api.0003_subscriptionpagesettings`.
Доступ к редактору: действующий staff/access + права
`admin_api.view_subscriptionpagesettings` и `admin_api.change_subscriptionpagesettings`
(для записи). Сохранение с revision исключает случайную перезапись параллельным редактором.

## Контракт

```json
{
  "schema_version": 1,
  "revision": 0,
  "theme": {
    "accent": "#22d3ee", "accent_secondary": "#9775fa",
    "background": "#161b23", "surface": "#202733", "text": "#f4f7fb",
    "muted": "#a6b0c0", "border": "#354152",
    "gradient_from": "#9775fa", "gradient_to": "#22d3ee",
    "gradient_type": "radial", "gradient_angle": 135, "gradient_opacity": 12,
    "pattern": "grid", "pattern_color": "#8190a5", "pattern_opacity": 8,
    "pattern_size": 60, "card_radius": 16, "card_opacity": 75
  },
  "alerts": []
}
```

gradient_type: none/linear/radial. pattern: none/grid/dots/lines/diagonal.
Цвета — строго #RRGGBB. Прозрачность/интенсивность — целые 0–100,
угол 0–360, шаг узора 12–120 px, радиус 0–32 px.
Сервер и браузер проверяют схему, произвольный CSS/JS не принимается.
Три TypeScript-копии контракта (Admin V2, frontend, backend) должны обновляться
вместе с Django-сериализаторами.

Каждый из максимум шести алертов:
`{id: UUID, enabled: boolean, type: "info"|"success"|"warning"|"danger",
title: string, message: string, timeout_seconds: integer, dismissible: boolean}`.
Заголовок до 120 символов; непустое сообщение до 1200, только текст.
Скрытые алерты исключает Django; сервис и браузер дополнительно фильтруют enabled.
Таймаут 0 — постоянно, 1–3600 — автозакрытие после появления. Ручное закрытие
не запоминается между перезагрузками. Уже открытая страница не опрашивает API.

Ответы no-store. Запрос к Django ограничен 3 секундами и 64 КБ, без редиректов.
Браузер ждёт не больше 5 секунд. Ошибки/невалидный ответ дают стандартное оформление
без старых алертов; загрузка подписки продолжает работать.
В логи не выводятся исходные URL, конфигурация, токены или клиентские payload.
QR-коды сохраняют прежние контрастные цвета для читаемости.

## Предпросмотр

`/appearance-preview` использует настоящие компоненты, но только синтетические
данные и инструкции. Не запрашивает реальную подписку. CSP frame-ancestors разрешает
только указанный Admin V2; postMessage сверяет origin и родительское окно.
Отдельная HttpOnly-cookie `appearance_preview` открывает только JS/CSS/шрифты/изображения,
не защищённый app-config и не подписку; основная session-cookie не заменяется.

Размещайте админку и страницу на поддоменах одного сайта, чтобы браузер не блокировал
cookie iframe. Внешний reverse proxy не должен навешивать DENY/SAMEORIGIN на preview,
или блокировать точный frame-ancestors. Для обычной страницы политики сохраняются.
Пути `/api/subscription-page/appearance` и `/appearance-preview` всегда от корня,
даже с CUSTOM_SUB_PREFIX.

Локально запустите frontend на 127.0.0.1:3334:
`npm ci && npm run start:dev -- --host 127.0.0.1`.
В соседнем Delta_VPN/admin-v2 запустите dev server на 5178, затем откройте
`http://127.0.0.1:5178/admin-v2/subscription-preview.html`.
Это редактор с локальным черновиком и экспортом JSON. В production используйте
защищённый раздел Admin V2 и кнопку «Опубликовать».

## Сборка и проверки

Frontend: `npm ci`, `npm run typecheck`, `npm run start:build`.
Backend: `npm ci`, `npm run typecheck`, `NODE_ENV=production npm run build`,
`node --test tests/appearance.test.cjs`.
Dockerfile ожидает готовый frontend/dist — создайте его перед Docker build.
После изменения .env пересоздайте контейнер. Обычный restart не обновляет окружение.
API и проверки панели/подписки остаются прежними.

Локальные проверки не подтверждают production reverse proxy, cookies в конкретном
браузере, доступ к настоящему Django/Remnawave или запуск Docker-образа.
