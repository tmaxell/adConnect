# Eastwind AdConnect — frontend (AI-agents prototype)

Фронтенд-прототип ИИ-фич (агенты сборки кампаний, сегментов и креативов) для
продукта **Eastwind AdConnect**.

Архитектура повторяет `cvm-agents/frontend`:

- **Плавающий AI-виджет** (`src/components/FloatingWidget.tsx`) перенесён без
  изменений — со всеми возможностями (FAB → панель → dock/expanded, история
  диалогов, план вызова агентов, action-карточки, источники, markdown) и тем же
  типом отображения. Чат-инфраструктура (`api/chatApi.ts`,
  `chat-workspace/store`, `types`, `MarkdownText`, `Sources`) скопирована as-is
  и работает с тем же backend-контрактом (`/api/chat`, `/api/sessions`).
- **Основной экран** взят от продукта AdConnect:
  `src/components/AdConnectMock.tsx` + `src/styles/adconnect-mock.css` —
  статичная реконструкция по экранам из `../screens` (топбар, боковое меню,
  список «Advertising campaigns»). Заменяет `AdTargetMock` из cvm-agents.

Dock-режим виджета смещён под 55px-топбар AdConnect (vs 48px у AdTarget);
`.ac-body` ужимается на `--fw-shell-shrink`, который выставляет сам виджет.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173 (или --port 5174)
```

Бэкенд агентов — общий с `cvm-agents` (этот фронт ожидает `/api/*`). Без
поднятого бэкенда UI работает как статичный макет: виджет открывается, фон
AdConnect рендерится, запросы к агенту тихо ретраятся.

## Следующие шаги (обсуждается)

- Связать артефакты агента с экранами AdConnect (мастер создания кампании:
  Sending Channel → Segments → Message → Cost → Confirmation; сборка сегментов;
  креативы) — сейчас фон статичный.
