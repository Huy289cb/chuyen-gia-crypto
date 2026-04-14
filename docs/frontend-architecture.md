# Frontend Architecture

## Overview

Frontend được xây dựng trên **Next.js 15** với **TypeScript** và **Tailwind CSS**, thiết kế theo phong cách professional, elegant, responsive.

## Migration từ React + Vite

| Từ | Sang |
|----|------|
| React 18 + Vite | Next.js 15 App Router |
| JSX | TypeScript TSX |
| `src/` folder | `app/` folder (App Router) |
| Client-side only | SSR + CSR hybrid |
| Port 5173 | Port 3000 |

## Tech Stack

- **Framework**: Next.js 15.1.3 + React 19
- **Language**: TypeScript 5.7
- **Styling**: Tailwind CSS 3.4
- **UI**: Lucide React icons
- **Fonts**: Inter (sans), JetBrains Mono (mono)

## Project Structure

```
frontend/
├── app/                    # App Router (Next.js 15)
│   ├── layout.tsx         # Root layout với fonts + ThemeProvider
│   ├── page.tsx           # Dashboard page
│   ├── globals.css        # CSS variables + themes
│   ├── layout/            # Layout components
│   │   ├── Header.tsx     # Sticky header + theme toggle
│   │   └── Footer.tsx     # Risk disclaimer
│   ├── sections/          # Page sections
│   │   ├── HeroSection.tsx
│   │   ├── TradingDashboard.tsx
│   │   ├── PositionsSection.tsx
│   │   ├── HistorySection.tsx
│   │   ├── PredictionsSection.tsx
│   │   └── PerformanceSection.tsx
│   ├── components/        # Reusable components
│   │   ├── ThemeProvider.tsx
│   │   ├── ui/            # UI primitives
│   │   │   ├── Card.tsx
│   │   │   ├── Badge.tsx
│   │   │   └── Button.tsx
│   │   └── crypto/
│   │       └── CryptoCard.tsx
│   ├── hooks/             # Custom hooks
│   │   ├── useTrends.ts
│   │   └── usePaperTrading.ts
│   └── types/             # TypeScript definitions
│       └── index.ts
├── lib/
│   └── utils.ts           # Utility functions
├── public/                # Static assets
├── tailwind.config.ts     # Tailwind config (darkMode: class)
└── next.config.js         # Next.js config
```

## Design System

### Colors

**Light Theme (Default)**
- `--bg-primary`: #fafafa
- `--bg-secondary`: #ffffff
- `--text-primary`: #18181b
- `--accent-primary`: #d97706 (gold)

**Dark Theme**
- `--bg-primary`: #0a0a0f
- `--bg-secondary`: #12121a
- `--text-primary`: #fafafa
- `--accent-primary`: #f59e0b (gold)

### Components

#### Card
```tsx
<Card glow padding="md">Content</Card>
```

#### Badge
```tsx
<Badge variant="success">BUY</Badge>
```

#### Button
```tsx
<Button variant="primary" leftIcon={<Icon />}>Action</Button>
```

## Theme System

### ThemeProvider
Context quản lý dark/light mode với localStorage persistence:

```tsx
const { theme, toggleTheme, setTheme } = useTheme();
```

### Toggle Button
Header có theme toggle button (Sun/Moon icon), mặc định là **Light mode**.

### CSS Variables
Tất cả colors sử dụng CSS variables để tự động chuyển đổi theme:
```css
:root { /* Light */ }
.dark { /* Dark */ }
```

## Data Fetching

### useTrends Hook
```ts
const { data, loading, error, refetch } = useTrends();
// Polling: 15 minutes
// Returns: prices, analysis
```

### usePaperTrading Hook
```ts
const { accounts, positions, tradeHistory, resetAccount, closePosition } = usePaperTrading();
// Polling: 30 seconds
```

## Responsive Design

- **Mobile-first**: Base styles cho mobile
- **Breakpoints**: sm:640px, md:768px, lg:1024px, xl:1280px
- **Grid**: `grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-4`

## Performance

- Static generation cho main page
- Component-level code splitting
- Optimized images (Next.js Image)
- CSS variables cho theme switching (no JS recalculation)

## Build Output

```
.next/
├── static/          # Static assets
├── server/          # Server-side code
└── [routes]/        # Pre-rendered pages
```

Build command: `npm run build`
Output: Static + SSR hybrid
