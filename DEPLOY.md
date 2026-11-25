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
- API: `GET /api/health`, `GET /api/stats`, `GET /api/catalog?q=&sort=recent|likes`, `POST /api/catalog`, `POST /api/catalog/:id/like`;
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
