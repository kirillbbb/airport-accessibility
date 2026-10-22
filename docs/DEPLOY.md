# Деплой на Vercel и GitHub Pages

Сайт размещается как готовые статические файлы. Все данные уже находятся в репозитории, в `dist/data/`. Сборщики данных при деплое запускать не нужно.

## Vercel

### 1. Импортировать репозиторий

1. Войдите в [Vercel](https://vercel.com/new).
2. Выберите **Add New → Project** (или **New Project**).
3. В разделе импорта Git-репозитория выберите GitHub. Если репозитория нет в списке, подключите аккаунт и предоставьте Vercel доступ к `kirillbbb/airport-accessibility`.
4. Найдите **airport-accessibility** и нажмите **Import**.

### 2. Проверить настройки

| Поле | Значение |
| --- | --- |
| Project Name | `airport-accessibility` или ваше название |
| Framework Preset | **Other** |
| Root Directory | Корень репозитория: `./` |
| Output Directory | **dist** |
| Build Command | Пустое поле; при ручной настройке включите **Override** |
| Install Command | Пустое поле; при ручной настройке включите **Override** |
| Environment Variables | Не добавлять |

Настройки сборки, установки и выходного каталога уже заданы в корневом `vercel.json`. Root Directory оставьте корнем репозитория: так Vercel прочитает этот файл. Значение `dist` задаётся именно в Output Directory.

Нажмите **Deploy**, дождитесь статуса **Ready**, затем откройте выданный адрес `*.vercel.app`.

### 3. Проверить сайт

- Без дополнительных параметров открывается общий календарь всех четырёх аэропортов.
- Есть разделы «Обзор» и «О данных».
- Фильтры меняют календарь; нажатие на цветной участок открывает эпизод и ссылки на источники.
- Скачиваются CSV и JSON. Последний день архива отмечен как неполный.

Открытие сайта не запускает сбор новых данных: он продолжит показывать сохранённый срез за сентябрь–октябрь 2026 года.

### Обновления Vercel

При подключённой Git-интеграции Vercel создаёт деплои из новых коммитов. Проверьте, что Production Branch проекта — **main**. Изменения, отправленные в эту ветку, будут обновлять основной сайт. Данные обновляются только после замены файлов в репозитории.

### Если что-то не работает на Vercel

| Симптом | Что проверить |
| --- | --- |
| 404 на главной | Root Directory — `./`, Output Directory — `dist`; в репозитории есть `dist/index.html` |
| Vercel пытается выполнить `npm run build` | Framework — Other, Build Command и Install Command пустые; корневой `vercel.json` присутствует |
| Есть оболочка, но данные не загрузились | В деплое должен открываться путь `/data/dataset.json`; каталог `dist/data/` должен попасть в коммит |
| Старый интерфейс | На странице деплоя проверьте ветку и коммит; откройте последний успешный деплой |

Источники: [импорт Git-репозитория](https://vercel.com/docs/git#deploying-a-git-repository), [статический сайт без сборки](https://vercel.com/docs/builds/configure-a-build#skip-build-step), [каталог выходных файлов](https://vercel.com/docs/builds/configure-a-build#output-directory).


## GitHub Pages

Vercel и GitHub Pages могут одновременно публиковать этот репозиторий. Оба используют одну папку `dist/`; копировать сайт в отдельную ветку или менять настройки Vercel не требуется.

1. В репозитории откройте **Settings → Pages**.
2. В разделе **Build and deployment → Source** выберите **GitHub Actions**. Вариант **Deploy from a branch** с корнем `main` публикует README, поскольку `index.html` находится внутри `dist/`.
3. Workflow уже добавлен: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). Создавать ещё один шаблон не нужно.
4. Откройте **Actions → Deploy GitHub Pages → Run workflow**, выберите ветку **main** и запустите публикацию. Если запуск ещё идёт после коммита, дождитесь его завершения.
5. Дождитесь зелёного статуса. Адрес появится в результатах job и в **Settings → Pages**. Без собственного домена он будет [kirillbbb.github.io/airport-accessibility/](https://kirillbbb.github.io/airport-accessibility/).

Workflow отправляет только содержимое `dist/`, включая JSON/CSV. Относительные пути позволяют тем же файлам работать и в корне Vercel, и в подпапке Pages. Секреты и API-ключи добавлять не нужно.

После включения Pages каждый push в `main` запускает публикацию Pages. Если Vercel подключён к той же ветке, он также обновляется своим обычным способом. Деплои независимы: оба нужно дождаться отдельно. Данные останутся сохранённым историческим срезом.

Если по-прежнему виден README, проверьте **Source = GitHub Actions**, успешность последнего **Deploy GitHub Pages**, затем обновите страницу. Если workflow пишет, что Pages не настроен, сначала выполните шаги 1–2 и повторите запуск. Если сайт работает на Vercel, а файлы на Pages не загружаются, проверьте завершающий `/` в адресе и запрос `/airport-accessibility/data/dataset.json`.

[Официальная инструкция GitHub по выбору источника публикации](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow).
