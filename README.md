# LOST INTERNET — web app

Dark Webcore / Y2K локальный музыкальный плеер с постоянным публичным адресом.

## Что умеет

- импорт локальных аудиофайлов: файлы, папка, drag & drop с полноэкранным индикатором;
- MP3/WAV/FLAC/OGG/M4A/AAC через браузерный `<audio>`;
- play/pause, prev/next, seek, volume/mute, shuffle, repeat off/all/one;
- парсинг ID3: title, artist, album, genre и обложка APIC; для WAV — sample rate и bitrate;
- обложка с обработкой: ч/б, зерно, сканлайны, геометрия, глитч на смене трека;
- библиотека, поиск, сортировка по колонкам, избранное, архив, unknown-треки;
- очередь NOW PLAYING и счётчик прослушиваний;
- плейлисты: создание, переименование, удаление, добавление, reorder, удаление треков;
- визуализатор Web Audio: spectrum / globe / hybrid, регулировка чувствительности;
- настройки атмосферы: scanlines, grain, glitch, calm mode, системные popup-окна;
- перетаскиваемые popup-окна Internet Explorer, Favorites, About;
- меню File / View / Playback / Help, экспорт метаданных, очистка архива;
- горячие клавиши: Space, N, P, M, S, R, 1/2/3, Ctrl+O, Ctrl+F, Ctrl+Left/Right, Esc;
- сохранение файлов, обложек, плейлистов, настроек и последнего трека в IndexedDB;
- адаптивная компоновка, мобильный режим и уважение reduced motion.

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

Для постоянного домена используйте named tunnel или деплой `dist` на Netlify/Vercel/любой статический хостинг. Подробности — `DEPLOY.md`.

Важно: каждый пользователь добавляет свои аудиофайлы в свой браузер. Файлы не загружаются на сервер и не общаются между пользователями.

## Структура

- `src/App.tsx` — точка входа React, рендерит только `LostInternetApp`;
- `src/components/LostInternetApp.tsx` — всё приложение;
- `src/components/LostInternetApp.css` — стили;
- `server/index.mjs` — Express-сервер для dev/prod раздачи.

## Стек

React 19, TypeScript, Vite 6, Express 4, Web Audio API, IndexedDB.
