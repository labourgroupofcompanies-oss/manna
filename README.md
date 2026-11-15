# Okada Book 🏍️

> A simple motorcycle (Okada) booking platform designed for Ghana.

Okada Book connects customers requiring motorcycle transportation with available independent riders. The customer flow is streamlined to three steps:
1. Enter phone number
2. Describe request (text or voice note)
3. Submit order

---

## 🛠️ Technology Stack

- **Frontend:** React 18
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** Plain CSS with CSS Custom Properties (Design Tokens)
- **Application Type:** Progressive Web App (PWA) via `vite-plugin-pwa`
- **Backend Readiness:** Supabase (`@supabase/supabase-js`)
- **Package Manager:** npm

---

## 📂 Project Structure

```
AGshop/
├── public/
│   ├── favicon.svg
│   └── icons/
│       ├── icon-192x192.svg
│       └── icon-512x512.svg
├── src/
│   ├── assets/              # Static assets & media
│   ├── components/          # Reusable UI components
│   │   ├── admin/           # Admin console components (stubbed)
│   │   ├── common/          # Shared atomic components (Button, Card, Input)
│   │   ├── customer/        # Customer flow components (stubbed)
│   │   ├── orders/          # Order management components (stubbed)
│   │   ├── rider/           # Rider portal components (stubbed)
│   │   └── voice/           # Voice recording components (stubbed)
│   ├── hooks/               # Custom React hooks (useVoiceRecorder, etc.)
│   ├── layouts/             # App shell layouts (AppLayout)
│   ├── pages/               # Top-level view containers
│   │   ├── admin/           # Admin operations
│   │   ├── customer/        # Customer booking
│   │   └── rider/           # Rider dispatch
│   ├── services/            # API & external service adapters
│   │   ├── orders/          # Order services
│   │   ├── supabase/        # Supabase client & initialization
│   │   └── voice/           # Audio storage & transcription services
│   ├── styles/              # Global styles & design system tokens
│   │   ├── global.css
│   │   └── tokens.css
│   ├── types/               # TypeScript domain models (order, user, voice)
│   ├── utils/               # Utilities & phone formatters for Ghana
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── .env.example             # Supabase environment variables template
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🎨 Design Tokens

The application styling follows mobile-first design tokens configured in `src/styles/tokens.css`:

| Token | Value | Role |
| :--- | :--- | :--- |
| `--color-primary` | `#063A9B` | Primary brand blue |
| `--color-secondary` | `#0B57D0` | Interactive blue / hover states |
| `--color-accent` | `#FFC107` | Accent yellow |
| `--color-white` | `#FFFFFF` | Background cards & text inverse |
| `--color-dark-navy` | `#101B3D` | Headings & dark backgrounds |
| `--color-bg-light` | `#F5F8FF` | App page background |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18+ (tested with v24.12.0)
- **npm**: v9+ (tested with v11.6.2)
- **Git**

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd AGshop
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   ```bash
   cp .env.example .env
   ```
   Add your Supabase project credentials in `.env` when ready:
   - `VITE_SUPABASE_URL`: Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous / public key

   *(Note: The application includes a fallback client so it runs smoothly even before credentials are provided.)*

### Running the Development Server

To launch the local Vite development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`.

### Building for Production

To create a type-checked production build with PWA service worker and manifest:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

---

## 📱 Progressive Web App (PWA) Features

- Web App Manifest configured in `vite.config.ts`.
- Auto-updating Service Worker configured in `src/main.tsx`.
- Touch-friendly UI targets (minimum 48px hit areas).
- Add to Home Screen installable support.
