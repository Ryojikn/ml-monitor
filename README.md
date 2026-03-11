# MLMonitor — ML Model Observability Platform

Production-grade monitoring system for machine learning models in production. Track data drift, prediction drift, model performance, and data quality across your entire ML portfolio.

Inspired by [Arize AI](https://arize.com), [NannyML](https://nannyml.com), [Evidently AI](https://evidentlyai.com), and [WhyLabs](https://whylabs.ai).

![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel)

---

## Features

### 1. Model Registry & Onboarding
- 7-step wizard for registering new models
- Configurable data sources (S3, GCS, SQL, Kafka, Delta)
- Column mapping (features, predictions, targets, segments)
- Scheduling via cron expressions

### 2. Metrics Engine
- **Data Drift**: PSI, Kolmogorov-Smirnov, Jensen-Shannon Divergence, Wasserstein Distance
- **Prediction Drift**: PSI on prediction distributions
- **Performance**: AUC-ROC, F1, RMSE, R² with temporal tracking
- **Data Quality**: Missing rates, outlier detection, schema validation

### 3. Execution Engine
- Multi-engine support: local (pandas), Spark, Dask, Ray, SQL pushdown
- Run history with duration, status, and error tracking

### 4. Alert System
- Configurable thresholds (static + dynamic)
- Severity levels: INFO / WARNING / CRITICAL
- Multi-channel: Slack, Email, PagerDuty, Webhook
- Alert lifecycle: open → acknowledged → resolved

### 5. Dashboard
- **Model Overview**: Portfolio health at a glance with sparkline trends
- **Model Detail**: Drill-down with drift timelines, feature heatmaps, distribution comparison (baseline vs current)
- **Alerts View**: Filterable timeline with full context

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Deploy to Vercel

### Option A — Via GitHub (recommended)

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Vercel auto-detects Vite — click **Deploy**

### Option B — Via CLI

```bash
npm i -g vercel
vercel
```

The included `vercel.json` handles SPA routing automatically.

---

## Project Structure

```
ml-monitor-app/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── AlertsView.jsx        # Alerts & incidents page
│   │   ├── Icon.jsx              # Feather-style SVG icons
│   │   ├── ModelDetail.jsx       # Tabbed deep-dive (drift, features, performance, quality, runs, config)
│   │   ├── ModelOverview.jsx     # Portfolio grid with filters
│   │   ├── OnboardingWizard.jsx  # 7-step model registration
│   │   └── ui.jsx                # Shared primitives (Card, Badge, Button, MetricCard, Sparkline, etc.)
│   ├── data/
│   │   └── generators.js         # Synthetic data generation
│   ├── utils/
│   │   ├── constants.js          # Teams, model types, engines, features
│   │   ├── helpers.js            # Formatting, uuid, rng utilities
│   │   └── theme.js              # Design tokens & semantic color lookups
│   ├── App.jsx                   # Root component (shell, nav, routing)
│   ├── index.css                 # Global styles & CSS variables
│   └── main.jsx                  # React entry point
├── index.html                    # Vite HTML entry
├── package.json
├── vercel.json                   # SPA rewrite rules
├── vite.config.js
└── .gitignore
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Dashboard (React + Recharts)          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌────────┐ │
│  │  Model    │  │ Model Detail │  │  Alerts   │  │Onboard │ │
│  │ Overview  │  │  (6 tabs)    │  │  View     │  │ Wizard │ │
│  └──────────┘  └──────────────┘  └───────────┘  └────────┘ │
│         │              │                │                     │
│         └──────────────┼────────────────┘                     │
│                        ▼                                      │
│              ┌──────────────────┐                             │
│              │  Data Layer       │                             │
│              │  (generators.js)  │ ← Replace with API calls   │
│              └──────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

The data layer currently uses synthetic generators. To connect a real backend, replace the imports in `App.jsx` with API calls to your FastAPI/Flask service.

---

## Connecting a Real Backend

Replace the synthetic data imports with fetch calls:

```javascript
// Before (synthetic)
import { MODELS, ALL_ALERTS } from './data/generators.js'

// After (real API)
const [models, setModels] = useState([])
useEffect(() => {
  fetch('/api/v1/models').then(r => r.json()).then(setModels)
}, [])
```

### Expected API Endpoints

```
GET    /api/v1/models                    → List models
GET    /api/v1/models/{id}               → Model detail
POST   /api/v1/models                    → Register model
GET    /api/v1/models/{id}/drift         → Feature drift results
GET    /api/v1/models/{id}/metrics       → Performance metrics
GET    /api/v1/models/{id}/runs          → Execution history
GET    /api/v1/alerts                    → Global alerts
POST   /api/v1/models/{id}/runs/trigger  → Manual trigger
```

---

## Tech Stack

| Layer         | Technology                    |
|---------------|-------------------------------|
| Framework     | Vite 5.4 + React 18          |
| Charts        | Recharts                      |
| Styling       | CSS-in-JS (inline styles)     |
| Typography    | DM Sans + JetBrains Mono      |
| Icons         | Custom feather-style SVG      |
| Deploy        | Vercel                        |

---

## License

MIT
