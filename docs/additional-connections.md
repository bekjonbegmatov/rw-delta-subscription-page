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

URI/Plain/Base64 сохраняют неизвестные параметры без потерь: VLESS, VMess
(QR JSON и AEAD), Trojan, SS (SIP002/legacy), SSR, Hysteria/2/hy2, TUIC,
WireGuard/wg, SOCKS/5/5h, HTTP(S) proxy, AnyTLS, SSH, naive+https.
Эмодзи, кириллица и пробелы в названии после # автоматически URL-кодируются.
URI не скачиваются и не исполняются. Формат API vless исторический: теперь это URI-список.

В Xray JSON преобразуются VLESS, оба VMess, Trojan, SS без plugin, SOCKS и HTTP(S):
TCP/RAW/HTTP header, WS, gRPC gun/multi/authority, XHTTP/splithttp с extra,
HTTPUpgrade, mKCP, legacy h2 и QUIC. TLS/Reality сохраняют pcs/vcn/ech,
alpn/fp/pbk/sid/spx/pqv; также fm, VLESS encryption/flow.
Локальный SOCKS inbound — 127.0.0.1:10808. Возможности зависят от версии ядра.
Неизвестный/непредставимый параметр не выбрасывается из JSON: всё правило
пропускается для этого формата, но продолжает работать для URI. Другие правила
продолжают применяться; частично преобразованное replace не удаляет ответ панели.
allowInsecure=true не преобразуется для современного Xray, где опция удалена.
Полные Xray JSON-профили (объект с outbounds или массив) передаются напрямую
только Xray JSON-клиентам. Для нестандартных настроек используйте их.
Sing-box, Clash/Mihomo/Stash,
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

Обновление URI-редактора требует нового кода всех трёх сервисов (Django, Admin V2,
subpage), но не добавляет миграций, env или зависимостей.
Сверка: https://github.com/XTLS/Xray-core/discussions/716,
https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link.
