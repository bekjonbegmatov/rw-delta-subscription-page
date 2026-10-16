# Admin V2: дополнительные подключения и favicon

Обновите оба репозитория; в Delta_VPN нужна миграция
admin_api.0004_subscriptionextrasettings. Публичный API оформления для секретов
не используется. В `.env` subscription-page:

```dotenv
SUBSCRIPTION_RULES_URL=http://django:8080/internal/subscription-page/rules/
SUBSCRIPTION_RULES_TOKEN=<отдельный-случайный-токен-не-короче-32-символов>
FAVICON_PUBLIC_URL=https://your-cdn.example/icon.png
```

В Django: такой же SUBSCRIPTION_RULES_TOKEN и отдельный
SUBSCRIPTION_RULES_ENCRYPTION_KEY (Fernet). Не используйте API-токен Remnawave.
Секреты нельзя помещать в Git или VITE_*. Без URL+token дополнения выключены;
нужно задавать оба. Нет новых npm-зависимостей.

Оба контейнера должны иметь общую Docker-сеть (у Delta — deltavpn). Django
вызывается напрямую, не через публичный web-домен: forwarded-заголовки на
private endpoint запрещены. Закройте `/internal/*` на публичных reverse proxies;
не публикуйте Django:8080 напрямую. Не печатайте успешный private response —
он содержит секреты.

Admin V2 → Доп. подключения: включение, статусы ACTIVE/EXPIRED/LIMITED/DISABLED,
append/replace, порядок, проверка выбора правил. Все совпавшие совместимые
правила объединяются по порядку; хотя бы один replace исключает исходные
подключения. Новые правила выключены. DISABLED выбирается явно.

Поддерживаются VLESS URI (TCP/RAW, WS, gRPC, TLS/Reality, encryption=none) в plain
и Base64 ответах; для Xray JSON они преобразуются в отдельные профили с локальным
SOCKS inbound 127.0.0.1:10808. Полные Xray JSON-профили (объект с outbounds или
массив) применяются только к Xray JSON. Неизвестные параметры VLESS отклоняются;
сложный транспорт требует готового JSON. Sing-box, Clash/Mihomo/Stash,
зашифрованные/неизвестные ответы остаются без изменений. Дополнения выдаются
VPN-приложению, не вставляются в список ключей HTML-страницы.

Сначала нужен обычный HTTP 200 панели и поддерживаемый формат без HWID-запрета.
Далее — свежие правила и защищённая проверка Raw Subscription API. Нужен контракт
с convertedUserInfo.hwidCheckup и право API-токена панели читать Raw Subscription.
Неизвестный контракт/пользователь, отказ HWID, ошибка источника или объединения
оставляют исходный ответ. 403/404/451/socket-drop не обходятся. Нет stale-кэша
или повторов. Raw API может зарегистрировать устройство/записать запрос как
часть обычного обновления подписки; SRR disableHwidCheck не отменяет эту проверку.
HTTP 200 custom remarks — обычный ответ; полный запрет задавайте BLOCK/404/451.

Expiry, traffic и subscription-userinfo не подменяются. Некоторые приложения
блокируют весь expired/limited профиль — проверьте свои клиенты или используйте
отдельный профиль общих подключений. Отключение правила не отзывает скопированный
UUID: его надо отключить на VPN-сервере. До 100 правил, 100 подключений/64 КиБ
на правило, 512 КиБ суммарно.

FAVICON_PUBLIC_URL: публичный HTTPS PNG/ICO/SVG без авторизации. Пусто — штатные
иконки. Сервер не скачивает URL, его получает браузер (CDN видит запрос).
Favicon links заменяются одним экранированным link. Работает для реальной
страницы и backend `/appearance-preview`. Для сброса кэша используйте новый
путь или ?v=2. Новое окружение применяется после recreate, не restart.

Первое обновление: frontend нужно собрать перед Docker build:

```bash
cd /opt/rw-delta-subscription-page/frontend
npm ci
npm run start:build
cd ..
docker compose up -d --build --force-recreate remnawave-subscription-page
```

Сохраняйте свои Compose overrides / -f флаги и сеть deltavpn. Полная инструкция,
permissions, защита ключа шифрования: Delta_VPN/docs/subscription-extras.md
в соседнем репозитории.

Проверки без живой панели:

```bash
cd backend
npm run typecheck
npm run build
node --test tests/appearance.test.cjs tests/extras.test.cjs
```

Это не проверка реального Remnawave/HWID, Caddy или VPN-клиентов. После обновления
владельцу нужно проверить свои приложения на отдельном тестовом пользователе.
