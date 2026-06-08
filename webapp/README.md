# Scriptor — Webapp

React + Vite + TypeScript + Tailwind CSS + shadcn/ui.
Vervangt de oude `akte-generator.html`.

## Lokaal draaien (zonder Docker)

```bash
cd webapp
npm install
npm run dev
```

Open daarna http://localhost:5173.

## Via Docker stack

De webapp wordt meegebouwd en geserveerd door de `webapp` service in
`docker-compose.yml`. Opstarten vanuit de project-root:

```bash
docker compose --profile cpu up --build
```

De app is bereikbaar op http://localhost:8080.

Gegenereerde aktes staan op http://localhost:8080/output/<bestand>.docx
(alias naar `shared/output/`).

## Structuur

```
webapp/
├── Dockerfile              Multi-stage: node build → nginx
├── nginx.conf              Serveert de React build + /output alias
├── index.html              Vite entry
├── src/
│   ├── main.tsx            React root
│   ├── App.tsx
│   ├── index.css           Tailwind + notariële theme tokens
│   ├── lib/utils.ts        cn() helper (shadcn)
│   └── components/
│       ├── ui/             shadcn primitives (Button, Input, Card, Label, Badge)
│       ├── AkteGenerator.tsx
│       ├── UploadCard.tsx
│       ├── Stepper.tsx
│       └── StatusLog.tsx
├── tailwind.config.js
├── postcss.config.js
├── components.json         shadcn config
├── vite.config.ts
└── tsconfig*.json
```

## Shadcn componenten toevoegen

Deze repo bevat alleen de componenten die we gebruiken. Nieuwe toevoegen:

```bash
npx shadcn@latest add dialog
```

Dit schrijft naar `src/components/ui/`, dankzij de aliassen in
`components.json` en `tsconfig.app.json`.

## Notariële theme

Kleuren/fonts zijn gedefinieerd in `src/index.css` en gemapped in
`tailwind.config.js`. De palette:

- `parchment` / `parchment-dark` — achtergrond
- `ink` / `ink-soft` — tekst
- `gold` / `gold-light` / `gold-pale` — accent
- `success` / `danger` — statusindicatie
