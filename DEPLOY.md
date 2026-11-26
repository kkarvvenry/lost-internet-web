# Публикация LOST INTERNET

Приложение в основном клиентское: аудиофайлы остаются в IndexedDB конкретного браузера. Cloudflare Worker раздаёт статику и хранит только общий каталог метаданных в D1.

**Рабощая ссылка:** https://lost-internet-web.stepanb249.workers.dev

## 0. Постоянный публичный адрес: Cloudflare + GitHub (рекомендуется)

Это самый простой способ получить **постоянную ссылку без покупки домена**. Cloudflare бесплатно даёт адрес вида:

```text
https://lost-internet-web.stepanb249.workers.dev
```

Он публичный, работает круглосуточно и обновляется автоматически после `git push`.

> Полный домен вида `https://example.com` требует покупки/регистрации домена. Если покупать не хочешь — используй бесплатный `*.workers.dev`, это полноценный постоянный адрес.

### Что уже готово

- `npm run build` создаёт `dist/`;
- `public/_headers`, `manifest.webmanifest`, `icon.svg` и `sw.js` автоматически копируются в `dist/`; SPA-fallback включён через `not_found_handling: single-page-application`;
- `wrangler.jsonc` настроен на деплой `dist/`, Worker `src/worker.ts` и D1-базу `lost-internet-catalog`;
- `migrations/0001_init.sql` создаёт таблицу `catalog_tracks`;
- `migrations/0002_like_hits.sql` добавляет таблицу `catalog_like_hits` для защиты от спама лайками;
- `migrations/0003_catalog_likes_index.sql` добавляет индекс для быстрой сортировки по лайкам;
- `migrations/0004_publish_hits.sql` добавляет таблицу дневного лимита публикаций (10 с IP);
- `migrations/0005_integration_hits.sql` добавляет таблицу дневного лимита импорта плейлистов (20 с IP);
- `migrations/0006_accounts.sql` добавляет таблицы аккаунтов, сессий, облачных данных и лимита попыток входа;
- `migrations/0007_spotify_links.sql` добавляет состояния OAuth PKCE и личные Spotify-токены по аккаунтам;
- API: `GET /api/health`, `GET /api/stats`, `GET /api/catalog?q=&sort=recent|likes`, `POST /api/catalog`, `POST /api/catalog/:id/like`, `POST /api/integrations/playlist`, `GET /api/auth/me`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET|PUT /api/user/data`, `GET /api/spotify/auth`, `GET /api/spotify/callback`, `GET /api/spotify/link`, `POST /api/spotify/disconnect`;
- интерфейс переводится между RU и EN переключателем в titlebar или в `SETTINGS // LANGUAGE`, выбор сохраняется в IndexedDB;
- привязки к Yandex Music, Spotify, YouTube Music, Bandcamp, SoundCloud и MusicBrainz работают полностью на стороне браузера: ничего дополнительно деплоить и никакие ключи не нужны;
- импорт плейлистов Spotify/Яндекс.Музыки работает через Worker; публичные плейлисты Spotify читаются из публичной страницы плейлиста и не требуют ни входа, ни ключей; личная привязка Spotify требует только `SPOTIFY_CLIENT_ID`, общий серверный импорт — `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`, а Яндекс — `YANDEX_MUSIC_TOKEN` (см. ниже); в каталог и в IndexedDB попадают только метаданные треков;
- аккаунты работают без дополнительных секретов: пароли хэшируются PBKDF2, сессии хранятся в D1 и передаются через HttpOnly-cookie;
- каждый вошедший пользователь может привязать свой Spotify через OAuth PKCE; токены хранятся в D1 отдельно для каждого аккаунта и используются только для его импорта плейлистов;
- `.env` исключён из git;
- репозиторий создан, код запушен в `main`;
- сайт уже задеплоен и отвечает `200`.

Локальный Express-сервер проксирует `/api/*` на публичный Worker, поэтому раздел NETWORK работает и локально. Адрес API можно переопределить переменной `CATALOG_API` (по умолчанию используется живой `workers.dev`-адрес).

### Шаги

1. Репозиторий уже создан:

```text
https://github.com/kkarvvenry/lost-internet-web
```

2. Для обновления кода:

```powershell
git add .
git commit -m "Update player"
git push origin main
```

Ручной деплой из папки проекта:

```powershell
npm run deploy
```

Эквивалентно `npm run build && npx wrangler deploy`.

### Автодеплой через GitHub Actions

Workflow `.github/workflows/ci.yml` на каждый push в `main` сначала выполняет `npm ci`, `npm run build`, `npm test`, `npm run smoke`, а затем деплоит Worker. Если секреты не заданы, задача `deploy` не падает, а пропускается с предупреждением — проверки при этом остаются зелёными.

Добавь один repository secret:

1. GitHub → репозиторий `lost-internet-web` → **Settings → Secrets and variables → Actions → New repository secret**.
2. `CLOUDFLARE_API_TOKEN` — API token с правами **Edit** на **Workers Scripts** и **D1** для аккаунта Cloudflare. Если секрет уже создан как `LOST_INTERNET_CL`, переименовывать не обязательно: workflow принимает и это имя.
3. Account ID записан в `wrangler.jsonc` (`bdf7de56ab499f657fbe798c44d4ce0f`), поэтому отдельный `CLOUDFLARE_ACCOUNT_ID` не требуется.
4. После сохранения сделай `git push` или нажми **Run workflow** во вкладке Actions — задача `deploy` перестанет пропускаться.

### Импорт плейлистов Spotify и Яндекс.Музыки

Миграция уже применена к рабочей базе. Если поднимаешь проект с нуля:

```powershell
npx --yes wrangler@4.168.0 d1 execute lost-internet-catalog --remote --file=migrations/0005_integration_hits.sql
```

Endpoint `POST /api/integrations/playlist` принимает `{ "provider": "spotify" | "yandex", "url": "..." }` и возвращает список треков (название, артист, альбом, длительность, ссылка и, для Spotify, `previewUrl`) и поле `via` (`account` — личный Spotify пользователя, `server` — общий серверный токен, `embed` — публичная страница плейлиста, если Web API недоступен). Worker не скачивает аудио; кнопка `IMPORT AUDIO` в браузере забирает публичные 30-секундные превью `p.scdn.co` напрямую в IndexedDB пользователя и добавляет их в плейлист. Полноценные аудиофайлы Spotify через публичный Web API недоступны. Лимит — 20 запросов с IP в сутки.

Если нет ни привязки, ни серверных секретов, endpoint всё равно импортирует **публичный** плейлист Spotify через `embed`. Приватные плейлисты требуют личной привязки и работающего Web API. Для Яндекса без `YANDEX_MUSIC_TOKEN` endpoint по-прежнему отвечает `503`; остальной сайт работает нормально. Значения ключей вводятся только в GitHub Secrets или в терминал — не в чат и не в файлы репозитория.

### Личный Spotify для каждого аккаунта

Привязка использует OAuth Authorization Code + PKCE и требует только `SPOTIFY_CLIENT_ID`. Секрет клиента от пользователя не нужен.

1. Миграция `0007_spotify_links.sql` уже применена к рабочей базе. Для нового проекта:

```powershell
npx --yes wrangler@4.168.0 d1 execute lost-internet-catalog --remote --file=migrations/0007_spotify_links.sql
```

2. В Spotify Developer Dashboard открой своё приложение → **Edit Settings** → **Redirect URIs** и добавь точный адрес:

```text
https://lost-internet-web.stepanb249.workers.dev/api/spotify/callback
```

3. Добавь repository secret `SPOTIFY_CLIENT_ID` в **Settings → Secrets and variables → Actions**. Workflow при деплое запишет его в Worker через `wrangler secret put`. Для ручной записи:

```powershell
npx --yes wrangler@4.168.0 secret put SPOTIFY_CLIENT_ID
```

Команда запросит значение с клавиатуры. После изменения секретов повторный deploy не требуется — новые значения подхватываются сразу.

4. Вошедший пользователь открывает `LOGIN` → `account.txt` → `LINK SPOTIFY`, подтверждает доступ на странице Spotify и возвращается на сайт с флагом `?spotify=connected`. В панели импорта NETWORK появится имя подключённого Spotify; при импорте отображается метка `PERSONAL SPOTIFY`. Кнопка `DISCONNECT` удаляет токен только этого аккаунта.

Если `SPOTIFY_CLIENT_ID` не задан, `GET /api/spotify/auth` возвращает `503 spotify client id is not configured`. Если у пользователя нет привязки, а заданы оба серверных секрета, импорт сначала пробует общий Client Credentials token и помечает результат как `SERVER SPOTIFY`. Если Web API отказывает (например, 403 из-за регионального ограничения или требований к аккаунту приложения), Worker читает тот же публичный плейлист со страницы `/embed/playlist/...` и помечает результат как `PUBLIC SPOTIFY`. Для приватного плейлиста при отозванном токене импорт просит повторно подключить Spotify.

### Общий серверный Spotify и Яндекс.Музыка

Добавь нужные repository secrets в **Settings → Secrets and variables → Actions**:

- `SPOTIFY_CLIENT_SECRET` — секрет приложения Spotify; нужен только вместе с `SPOTIFY_CLIENT_ID` для серверного импорта без привязки пользователя;
- `YANDEX_MUSIC_TOKEN` — OAuth-токен Яндекс.Музыки для импорта плейлистов.

Workflow при деплое сам вызовет `wrangler secret put` для каждого заданного секрета. Если секрет не задан, шаг просто пропускается. Для ручной записи в Worker:

```powershell
npx --yes wrangler@4.168.0 secret put SPOTIFY_CLIENT_SECRET
npx --yes wrangler@4.168.0 secret put YANDEX_MUSIC_TOKEN
```

Каждая команда запросит значение с клавиатуры. После изменения секретов повторный deploy не требуется — новые значения подхватываются сразу. Проверить ответ без ключей можно так:

```powershell
Invoke-RestMethod -Uri 'https://lost-internet-web.stepanb249.workers.dev/api/integrations/playlist' -Method Post -ContentType 'application/json' -Body '{"provider":"spotify","url":"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"}'
```

### Аккаунты посетителей

Миграция `0006_accounts.sql` уже применена к рабочей базе. Для нового проекта:

```powershell
npx --yes wrangler@4.168.0 d1 execute lost-internet-catalog --remote --file=migrations/0006_accounts.sql
```

Регистрация и вход доступны каждому посетителю через кнопку `LOGIN` в titlebar. Worker хранит в D1 только email, PBKDF2-хэш пароля, сессионные токены и JSON с настройками/плейлистами/ссылками. Секреты и ключи для этого не нужны; лимит — 15 попыток входа/регистрации с IP в сутки.

Локальный архив аудио разделён по аккаунтам: для гостя используется база `lost-internet-web`, для вошедшего — `lost-internet-web-<id аккаунта>`. Аудио остаётся в IndexedDB браузера. Кнопки `SAVE TO ACCOUNT` и `LOAD FROM ACCOUNT` в окне `account.txt` синхронизируют только метаданные: настройки, плейлисты, избранное и ссылки. При входе на другом устройстве файлы нужно добавить заново — совпадения ищутся по названию и артисту.

Локальный Express-прокси передаёт заголовки `Cookie`/`Set-Cookie` и снимает флаг `Secure` с cookie, если открыт обычный `http://localhost`, поэтому вход работает и при `npm run dev`.

Привязка Spotify (`/api/spotify/auth`, `/api/spotify/callback`, `/api/spotify/link`, `/api/spotify/disconnect`) доступна только вошедшим пользователям и хранит токены в таблице `spotify_links`, а не в браузере. Подробности настройки — в разделе про личный Spotify выше.

Проверить токен локально можно так:

```powershell
$env:CLOUDFLARE_API_TOKEN='...'
$env:CLOUDFLARE_ACCOUNT_ID='...'
npx --yes wrangler@4.168.0 whoami
```

3. Зайди в Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
4. Выбери репозиторий `lost-internet-web`.
5. Настройки сборки:
   - Framework preset: `None`;
   - Build command: `npm run build`;
   - Build output directory: `dist`;
   - Node version: `22` (или `20`).
6. Нажми **Save and Deploy**. Через 1–2 минуты получишь `https://<project>.pages.dev`.
7. После каждого `git push` Cloudflare сам пересоберёт и опубликует сайт.

### Если позже захочешь свой домен

Купи домен у любого регистратора/Cloudflare, добавьте его в аккаунт Cloudflare, затем в проекте Pages: **Custom domains → Add custom domain**. SSL-сертификат Cloudflare выпустит автоматически.

## 1. Локальная сеть

```powershell
npm run dev
```

Сервер слушает `0.0.0.0`, поэтому с телефона/другого ПК в той же сети откройте:

```text
http://<IP-COMPUTER>:5173
```

IP можно узнать командой:

```powershell
ipconfig
```

Изменить порт:

```powershell
$env:PORT='8080'
npm run dev
```

## 2. Публичный URL без VPS (быстро)

Самый простой способ — Cloudflare Tunnel. Не нужно открывать порты роутера.

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5173
```

Команда выдаст временный `https://xxx.trycloudflare.com`. Для постоянного URLs настройте named tunnel в аккаунте Cloudflare.

Альтернатива: `ngrok http 5173`.

## 3. Статический хостинг (рекомендуется для прода)

Соберите статику:

```powershell
npm run build
```

Папка `dist/` содержит полностью готовое приложение. Её можно загрузить на:

- Netlify;
- Vercel;
- GitHub Pages;
- Cloudflare Pages;
- любой Nginx/Apache/other static hosting.

Пример для Netlify CLI:

```powershell
npx netlify-cli deploy --dir=dist --prod
```

## 4. VPS + домен + HTTPS

На сервере:

```bash
git clone <repo> lost-internet
cd lost-internet
npm ci
npm run build
PORT=8080 npm start
```

Nginx:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Локальный `/api/*` прокси передаёт `CF-Connecting-IP` и `X-Forwarded-For` на Worker, поэтому дневной лимит лайков работает и через Nginx/cloudflared.

HTTPS:

```bash
sudo certbot --nginx -d example.com
```

Системный сервис systemd:

```ini
[Unit]
Description=LOST INTERNET
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/lost-internet
Environment=PORT=8080
ExecStart=/usr/bin/node server/index.mjs --prod
Restart=always

[Install]
WantedBy=multi-user.target
```

## Важно

- Сервер раздаёт только приложение.
- Пользовательские треки и обложки не отправляются на сервер.
- Для общего каталога музыки нужен отдельный backend; текущая версия — персональный плеер каждого пользователя.
