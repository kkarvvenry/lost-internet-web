# LOST INTERNET — web app

Dark Webcore / Y2K локальный музыкальный плеер с постоянным публичным адресом.

История изменений: [CHANGELOG.md](CHANGELOG.md).

## Что умеет

- импорт локальных аудиофайлов: файлы, папка, drag & drop с полноэкранным индикатором;
- MP3/WAV/FLAC/OGG/M4A/AAC через браузерный `<audio>`;
- play/pause, prev/next, seek, volume/mute, shuffle, repeat off/all/one;
- настоящий кроссфейд на двух аудио-элементах: плавное перекрытие треков 0.2–3.0 с;
- 3-полосный эквалайзер с пресетами FLAT / BASS / VOCAL / NIGHT и ручной настройкой;
- компрессор/лимитер с порогом, ratio и makeup gain;
- парсинг ID3: title, artist, album, genre и обложка APIC; для WAV — sample rate и bitrate;
- обложка с обработкой: ч/б, зерно, сканлайны, геометрия, глитч на смене трека;
- библиотека, поиск, сортировка по названию/артисту/альбому/времени/прослушиваниям, избранное, архив, recent, unknown-треки; таблица виртуализируется на 60+ треков, поэтому большой архив не превращается в тысячи DOM-строк;
- очередь NOW PLAYING, счётчик прослушиваний и история последнего прослушивания;
- плейлисты: создание, переименование, удаление, добавление, reorder, удаление треков, экспорт в `.m3u`;
- редактирование метаданных трека и скачивание оригинального файла;
- визуализатор Web Audio: spectrum / globe / hybrid / scope, регулировка чувствительности и счётчик FPS; в calm mode он остаётся реактивным и плавным, но без глитчей и быстрого вращения;
- общий публичный NETWORK-индекс метаданных на Cloudflare Worker + D1: публикация трека, лайки, поиск, сортировка NEW/TOP, статистика; публикация ограничена 10 записями с IP в сутки, лайки дедуплицируются;
- настройки атмосферы: scanlines, grain, glitch, calm mode, системные popup-окна;
- смена темы DARK / LIGHT с плавным переходом, hotkey `T` и кнопкой в titlebar;
- перетаскиваемые popup-окна Internet Explorer, Favorites, About, Help; справка открывается кнопкой `?` или `H`, верхнее окно удерживает фокус внутри себя;
- меню File / View / Playback / Help, экспорт и импорт метаданных, очистка архива;
- горячие клавиши: Space, N, P, M, [ / ], F, S, R, H, T, 1/2/3/4, Ctrl+O, Ctrl+F, Ctrl+Left/Right, Esc;
- сохранение файлов, обложек, плейлистов, настроек и последнего трека в IndexedDB; в `CONFIG.SYS` показан счётчик `USED / QUOTA`;
- PWA: установка на телефон/десктоп, иконка, офлайн-кэш оболочки и плашка о доступном обновлении;
- адаптивная компоновка, мобильный режим с safe-area insets и крупными touch-целями, уважение reduced motion.

## Запуск

```bash
npm install
npm run dev      # http://localhost:5173
```

Прод-сборка:

```bash
npm run build
npm start
```

## Проверки

```bash
npm test     # unit-тесты форматирования, виртуализации таблицы и rate limit Worker
npm run smoke # проверка живого сайта, ассетов, PWA и API
npm run verify # build + test + smoke
```

GitHub Actions на push в `main` выполняет те же проверки и деплоит Worker. Для автодеплоя нужны repository secrets `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`; без них deploy пропускается, а не помечается как failed. Инструкция — `DEPLOY.md`.

## Доступ для других

Сервер слушает `0.0.0.0`, поэтому приложение доступно не только с localhost. По умолчанию порт `5173`; изменить можно через `PORT`.

Локальная сеть:

```powershell
npm run dev
# откройте http://<IP-компьютера>:5173 с другого устройства
```

Публичный доступ без VPS и порт-форвардинга — Cloudflare Tunnel:

```powershell
cloudflared tunnel --url http://localhost:5173
```

Постоянная публичная ссылка: https://lost-internet-web.stepanb249.workers.dev

Локальный Express-сервер проксирует `/api/*` на публичный Worker, поэтому NETWORK работает и при `npm run dev`. Адрес API можно переопределить через `CATALOG_API`.

Для постоянного домена используйте named tunnel или деплой `dist` на Netlify/Vercel/любой статический хостинг. Подробности — `DEPLOY.md`.

Важно: каждый пользователь добавляет свои аудиофайлы в свой браузер. Сам аудио не загружается на сервер — через общий NETWORK-индекс передаются только метаданные (название, артист, альбом, жанр, формат, длительность, лайки).

## Структура

- `src/App.tsx` — точка входа React, рендерит только `LostInternetApp`;
- `src/components/LostInternetApp.tsx` — всё приложение;
- `src/components/LostInternetApp.css` — стили;
- `src/worker.ts` — Cloudflare Worker с API `/api/health`, `/api/catalog`, `/api/catalog/:id/like`;
- `migrations/0001_init.sql` — схема D1 для общего каталога;
- `migrations/0002_like_hits.sql` — защита от повторных лайков с одного адреса в сутки;
- `migrations/0003_catalog_likes_index.sql` — индекс для сортировки NETWORK по лайкам;
- `migrations/0004_publish_hits.sql` — дневной лимит публикаций с одного адреса;
- `src/lib/format.ts`, `src/lib/table.ts` — чистые хелперы, покрытые unit-тестами;
- `scripts/smoke.mjs` — smoke-проверка публичного деплоя;
- `.github/workflows/ci.yml` — проверки и автодеплой;
- `wrangler.jsonc` — деплой и привязка D1;
- `server/index.mjs` — Express-сервер для dev/prod раздачи.

## Стек

React 19, TypeScript, Vite 6, Express 4, Cloudflare Workers, D1, Web Audio API, IndexedDB.
