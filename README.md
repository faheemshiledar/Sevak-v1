<div align="center">

# 🚨 SEVAK
### AI-Powered Emergency Response Platform

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%2B%20Auth-FFCA28?style=flat-square&logo=firebase)](https://firebase.google.com)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)](https://vitejs.dev)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3-F55036?style=flat-square)](https://groq.com)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-sevak2--a403d.web.app-brightgreen?style=flat-square&logo=firebase)](https://sevak2-a403d.web.app)
[![GitHub](https://img.shields.io/badge/GitHub-faheemshiledar%2FSevak--v1-181717?style=flat-square&logo=github)](https://github.com/faheemshiledar/Sevak-v1/)

**SEVAK** is a real-time, AI-powered emergency response coordination platform built for Indian communities. Citizens report emergencies via text, image, or voice. An AI pipeline classifies severity, auto-dispatches volunteers, and keeps coordinators in full control — all in real time.

[🚀 Live Demo](https://sevak2-a403d.web.app) · [📂 GitHub](https://github.com/faheemshiledar/Sevak-v1/) · [📋 Report a Bug](https://github.com/faheemshiledar/Sevak-v1/issues) · [💡 Request a Feature](https://github.com/faheemshiledar/Sevak-v1/issues)

---

![SEVAK Banner](https://via.placeholder.com/1200x400/6366f1/ffffff?text=SEVAK+%E2%80%94+AI+Emergency+Response+Platform)

> 🏆 Built by **Faheem Shiledar** · **Team NIRVANA**

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [AI Pipeline](#-ai-pipeline)
- [Role System](#-role-system)
- [Pages & Screens](#-pages--screens)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Firestore Data Model](#-firestore-data-model)
- [Case Lifecycle](#-case-lifecycle)
- [Demo Data](#-demo-data)
- [i18n — Language Support](#-i18n--language-support)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)

---

## 🌐 Overview

India faces a critical gap in emergency response coordination. First responders lack real-time situational awareness, citizens don't know who to contact, and volunteer networks are uncoordinated. SEVAK bridges this gap with a unified platform that uses AI to triage emergencies the moment they are reported.

```
Citizen reports emergency
        ↓
  AI Pipeline runs in parallel:
  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
  │ Google Vision   │  │ Google Speech    │  │ Llama 3.3 (Groq)     │
  │ Scene Analysis  │  │ Voice → Text     │  │ Triage & Classify    │
  └─────────────────┘  └──────────────────┘  └──────────────────────┘
        ↓
  AI assigns: Level (CRITICAL/HIGH/MEDIUM/LOW) + Type + Action
        ↓
  Auto-Dispatch Engine:
  → Notifies ALL volunteers & coordinators instantly
  → Auto-assigns nearest available volunteer for CRITICAL/HIGH cases
        ↓
  Real-time case tracking → Resolution → Analytics
```

---

## ✨ Key Features

### 🤖 AI-Powered Triage
- **Multimodal input** — text description, scene photograph, and voice recording all processed together
- **Google Vision AI** — detects accidents, fire, injuries, and emergency signals in uploaded photos with a short-circuit fast path for critical visual matches
- **Google Speech-to-Text** — transcribes voice reports in English, Hindi, and Marathi (en-IN, hi-IN, mr-IN)
- **Llama 3.3 70B via Groq** — classifies severity level, emergency type, and generates a one-sentence dispatch instruction with confidence score
- **Fallback classifier** — regex-based text classifier ensures the app works even without API keys

### ⚡ Auto-Dispatch Engine
- On CRITICAL or HIGH cases, the first available volunteer is automatically assigned
- All volunteers and coordinators receive in-app alerts the moment a case is submitted
- Assigned volunteers are immediately marked as unavailable to prevent double-booking

### 🔴 Real-Time Everything
- All case data, status changes, notes, and alerts update live via Firestore `onSnapshot` listeners
- The dashboard live feed shows new cases as they arrive with no page refresh needed
- Volunteer availability reflects live status across all coordinator views

### 👥 Three-Role Access System
- **Citizen** — report emergencies, track their own case resolution
- **Volunteer** — receive assignments, update status (On My Way → In Progress → Resolved), add notes
- **Coordinator** — full control over all cases, volunteer assignment, analytics, and system management

### 📊 Analytics Dashboard (Coordinator)
- Configurable time range: 7 days, 30 days, 90 days
- Daily case trend sparkline chart
- Cases broken down by severity level and emergency type
- Volunteer leaderboard ranked by cases handled and rating
- KPIs: total cases, resolution rate, average response time, active volunteer count

### 🗺️ Resource Map
- Google Maps integration with colour-coded severity markers
- Click any marker for full case detail panel
- Real-time volunteer availability overlay

### 🔔 Alert System
- Role-scoped in-app alerts (each user only sees their own)
- Unread badge in sidebar and topbar
- One-click navigation from alert directly to case detail
- Mark individual or all alerts as read

### 🌐 Bilingual UI
- Full English and Hindi (हिंदी) translations across all pages
- Language toggle in the sidebar, persists for the session
- Covers all UI strings, labels, placeholders, and error messages

---

## 🧠 AI Pipeline

The pipeline runs all analysis in parallel using `Promise.allSettled` so image and voice processing happen simultaneously, minimising latency.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        runPipeline()                                │
│                                                                     │
│  Input: text + image (base64) + audio (base64) + GPS address        │
│                                                                     │
│  Step 1 — Parallel (if inputs provided):                            │
│  ┌──────────────────────┐    ┌──────────────────────────┐           │
│  │  visionAnalyze()     │    │  speechToText()           │           │
│  │  Google Vision API   │    │  Google Speech API        │           │
│  │  • Label detection   │    │  • WEBM_OPUS encoding     │           │
│  │  • Text (OCR)        │    │  • en-IN primary          │           │
│  │  • Score > 0.65      │    │  • hi-IN, mr-IN fallback  │           │
│  │  • Critical check ⚡ │    │                           │           │
│  └──────────────────────┘    └──────────────────────────┘           │
│                                                                     │
│  Step 2 — Short-circuit check:                                      │
│  If Vision detects critical labels (accident, fire, explosion,      │
│  injury, blood, crash, smoke, ambulance, disaster)                  │
│  → Skip Groq, return HIGH immediately with 0.95 confidence         │
│                                                                     │
│  Step 3 — groqAnalyze()                                             │
│  Llama 3.3-70b-versatile via Groq API                               │
│  Input: combined text + voice transcript + vision labels + address  │
│  Output: { level, emType, confidence, action }                      │
│                                                                     │
│  Fallback: regex classifyText() + guessType() if no API key         │
└─────────────────────────────────────────────────────────────────────┘
```

**Emergency levels:** `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`

**Emergency types:** `MEDICAL` · `ACCIDENT` · `FIRE` · `FLOOD` · `VIOLENCE` · `OTHER`

---

## 👤 Role System

| Feature | 🏠 Citizen | 🙋 Volunteer | 🎯 Coordinator |
|---|:---:|:---:|:---:|
| Report Emergency | ✅ | ✅ | ✅ |
| Dashboard | ✅ | ✅ | ✅ |
| View All Cases | — | ✅ | ✅ |
| Case Detail | ✅ (own) | ✅ | ✅ |
| Update Case Status | — | ✅ (assigned) | ✅ |
| Assign Volunteers | — | — | ✅ |
| Release Volunteers | — | — | ✅ |
| Force Resolve / Re-open | — | — | ✅ |
| Resource Map | — | ✅ | ✅ |
| Volunteer Management | — | — | ✅ |
| Analytics | — | — | ✅ |
| Alerts | ✅ | ✅ | ✅ |
| Profile / Availability | ✅ | ✅ | ✅ |
| Load Demo Data | — | — | ✅ |

---

## 📱 Pages & Screens

### 📊 Dashboard
The command centre. Shows live KPI cards (total, pending, active, resolved), a real-time case feed table, volunteer availability panel, and response stats. Coordinators see a "Load Demo Data" button to populate the system with realistic Pune-area seed cases. Volunteers see their personally assigned cases highlighted at the top.

### 🆘 Report Emergency
Three-panel intake form:
1. **Text** — free-form description with a detailed placeholder
2. **Image** — camera capture or file upload, sent to Google Vision API
3. **Voice** — hold-to-record button, sends audio to Google Speech API

A live pipeline progress indicator shows each AI step as it runs. After submission, the AI result card shows the classified level, type, confidence percentage, and dispatch action.

### 📋 All Cases
Full case table with filters by status (PENDING / ASSIGNED / IN_PROGRESS / RESOLVED) and severity level (CRITICAL / HIGH / MEDIUM / LOW), plus a free-text search across description, reporter name, and type. Shows case count per filter.

### 🔍 Case Detail
The core operational screen. Includes:
- Gradient hero banner with level/type/status/confidence
- **Volunteer action panel** (only for assigned volunteer): progress stepper (Assigned → In Progress → Resolved), "I'm On My Way" button, resolve button with optional closing note
- **Coordinator controls**: status management buttons, force-resolve, re-open, volunteer assignment/release panel
- Case information card with all metadata
- AI analysis card with confidence bar
- Real-time team notes (sub-collection, live updates)

### 🗺️ Resource Map
Google Maps with colour-coded severity markers. Clicking a marker opens a detail side panel. Falls back to a case list view if no Maps API key is configured.

### 👥 Volunteer Management (Coordinator)
Table of all registered volunteers with email, skills, rating, cases handled, and availability status. Coordinators can toggle availability directly. Stat cards at the top show available/busy/total counts.

### 📈 Analytics (Coordinator)
- Time range selector: 7d / 30d / 90d
- KPI row: total cases, resolved count + rate, avg response time, active volunteers
- Daily trend bar chart (last 7 days)
- Cases by severity — horizontal progress bars with percentages
- Cases by type — horizontal progress bars
- Volunteer leaderboard with rank medals (🥇🥈🥉)

### 🔔 Alerts
Full notification inbox with unread/read state, severity colour coding, and one-click navigation to the associated case. "Mark all read" button.

### 👤 My Profile
- Profile header with avatar, role badge, availability pill
- Volunteers get a quick-toggle availability button
- Edit form: name, phone, skills (comma-separated for volunteers)
- Volunteer stats: cases handled, rating
- Skills tag display
- Account info card

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript |
| **Build Tool** | Vite |
| **Styling** | Inline styles + CSS-in-JS (single file, zero dependencies) |
| **Font** | Plus Jakarta Sans (Google Fonts) |
| **Auth** | Firebase Authentication (email/password + Google OAuth) |
| **Database** | Cloud Firestore (real-time `onSnapshot`) |
| **File Storage** | Firebase Storage (scene images) |
| **AI — Vision** | Google Cloud Vision API (label detection + OCR) |
| **AI — Speech** | Google Cloud Speech-to-Text API |
| **AI — LLM** | Llama 3.3 70B Versatile via Groq API |
| **Maps** | Google Maps JavaScript API |
| **i18n** | Custom context-based translation system (EN + HI) |

---

## 📁 Project Structure

```
sevak/
├── src/
│   ├── App.tsx          # Entire application (single-file architecture)
│   └── main.tsx         # React DOM entry point
├── public/
│   └── vite.svg
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── .env.local           # API keys (not committed)
```

> The entire application lives in `App.tsx` — ~2,500 lines covering all pages, components, AI logic, Firebase integration, dispatch engine, seed data, and i18n.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A Firebase project (Firestore + Auth + Storage enabled)
- API keys for Groq, Google Vision, Google Speech (optional but recommended)

### 1. Clone the repository

```bash
git clone https://github.com/[YOUR_USERNAME]/sevak.git
cd sevak
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root directory:

```env
# Firebase (required)
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# AI APIs (optional — app works without these using fallback classifiers)
VITE_GROQ_API_KEY=your_groq_api_key
VITE_GOOGLE_VISION_API_KEY=your_vision_api_key
VITE_GOOGLE_SPEECH_API_KEY=your_speech_api_key

# Maps (optional — falls back to list view)
VITE_GOOGLE_MAPS_API_KEY=your_maps_api_key
```

### 4. Configure Firebase

In the [Firebase Console](https://console.firebase.google.com):

**Authentication** → Enable Email/Password and Google sign-in providers.

**Firestore** → Create a database. Set rules to (development):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**Storage** → Create a bucket. Set rules to:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 6. Load demo data

Sign up with the **Coordinator** role, navigate to the Dashboard, and click **🌱 Load Demo Data**. This seeds:
- 4 demo volunteers with profiles, skills, and ratings
- 7 historical resolved cases (Pune area, last 6 days)
- 2 live active cases (one CRITICAL assigned, one HIGH pending)
- Alerts for your coordinator account

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|:---:|---|
| `VITE_FIREBASE_API_KEY` | ✅ | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | ✅ | Firestore project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✅ | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅ | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | ✅ | Firebase app ID |
| `VITE_GROQ_API_KEY` | ⚪ | Groq API key for Llama 3.3 classification |
| `VITE_GOOGLE_VISION_API_KEY` | ⚪ | Google Cloud Vision API key |
| `VITE_GOOGLE_SPEECH_API_KEY` | ⚪ | Google Cloud Speech-to-Text API key |
| `VITE_GOOGLE_MAPS_API_KEY` | ⚪ | Google Maps JavaScript API key |

> ⚪ Optional — the app degrades gracefully. Without Groq, a regex classifier runs. Without Vision/Speech, only text input is processed. Without Maps, a case list is shown instead.

---

## 🗄 Firestore Data Model

```
firestore/
│
├── users/{uid}
│   ├── email: string
│   ├── name: string
│   ├── role: 'citizen' | 'volunteer' | 'coordinator'
│   ├── available: boolean          # volunteers only
│   ├── skills: string[]            # volunteers only
│   ├── rating: number              # 1–5
│   ├── casesHandled: number
│   └── phone: string
│
├── cases/{caseId}
│   ├── reporterId: string
│   ├── reporterName: string
│   ├── description: string
│   ├── imageUrl: string            # Firebase Storage URL
│   ├── lat: number
│   ├── lng: number
│   ├── address: string
│   ├── level: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'
│   ├── emType: 'MEDICAL'|'ACCIDENT'|'FIRE'|'FLOOD'|'VIOLENCE'|'OTHER'
│   ├── confidence: number          # 0–1
│   ├── action: string              # AI dispatch instruction
│   ├── status: 'PENDING'|'ASSIGNED'|'IN_PROGRESS'|'RESOLVED'
│   ├── assignedTo: string          # volunteer uid
│   ├── assignedName: string
│   ├── shortCircuited: boolean     # Vision AI fast-path triggered
│   ├── visionLabels: string[]
│   ├── createdAt: Timestamp
│   ├── resolvedAt: Timestamp
│   ├── resolvedByName: string
│   ├── responseTimeMinutes: number
│   └── notes/{noteId}             # sub-collection
│       ├── author: string
│       ├── text: string
│       └── createdAt: Timestamp
│
├── alerts/{alertId}
│   ├── userId: string              # recipient uid
│   ├── title: string
│   ├── body: string
│   ├── level: Level
│   ├── caseId: string
│   ├── read: boolean
│   └── createdAt: Timestamp
│
└── _meta/seeded
    ├── at: Timestamp
    └── v: number                   # seed version
```

---

## 🔄 Case Lifecycle

```
  [Citizen submits report]
          │
          ▼
    ┌─────────────┐
    │   PENDING   │  ← AI classified, alerts sent to all volunteers/coordinators
    └─────────────┘
          │
          │  Auto-assign (CRITICAL/HIGH) OR coordinator assigns manually
          ▼
    ┌─────────────┐
    │  ASSIGNED   │  ← Volunteer receives personal alert, marked as unavailable
    └─────────────┘
          │
          │  Volunteer clicks "I'm On My Way"
          ▼
    ┌─────────────┐
    │ IN_PROGRESS │  ← System note added, team sees live status
    └─────────────┘
          │
          │  Volunteer resolves (with optional closing note)
          │  OR Coordinator force-resolves
          ▼
    ┌─────────────┐
    │  RESOLVED   │  ← Reporter notified, volunteer freed, response time logged
    └─────────────┘
          │
          │  Coordinator can re-open if needed
          ▼
    ┌─────────────┐
    │   PENDING   │  ← Back to top of queue
    └─────────────┘
```

---

## 🌱 Demo Data

The seed function (`seedDemoData`) populates your Firestore with realistic data for Pune, Maharashtra. It runs only once — a `_meta/seeded` sentinel document prevents duplicate seeding.

**What gets seeded:**

| Data | Count | Details |
|---|---|---|
| Demo volunteers | 4 | Arjun Patil, Priya Sharma, Rohan Desai, Sneha Kulkarni — with skills, ratings, and case history |
| Resolved cases | 7 | Historical cases over the past 6 days — accidents, fires, medical, flood |
| Live cases | 2 | 1 CRITICAL assigned (Baner Road accident) + 1 HIGH pending (Aundh medical) |
| Coordinator alerts | 2 | Auto-created for your coordinator account |

---

## 🌐 i18n — Language Support

SEVAK has full bilingual support via a custom `LangProvider` context. The language toggle sits in the sidebar bottom panel.

| Language | Code | Coverage |
|---|---|---|
| English | `en` | 100% — all UI strings |
| Hindi (हिंदी) | `hi` | 100% — all UI strings |

Adding a new language requires adding a matching key-value object to the `translations` map in `App.tsx` and adding the language to the `Lang` type and toggle UI.

---

## 🗺 Roadmap

- [ ] **Mobile-responsive layout** — PWA with bottom navigation for field use
- [ ] **Push notifications** — FCM integration so volunteers are alerted even when the tab is closed
- [ ] **WhatsApp integration** — report emergencies via WhatsApp message
- [ ] **Production Firestore rules** — role-based security rules replacing the open dev rules
- [ ] **Nearest volunteer assignment** — use GPS coordinates to assign the geographically closest available volunteer instead of first-in-list
- [ ] **Volunteer rating system** — coordinators rate volunteers after case resolution
- [ ] **Case export** — download case history as CSV/PDF for reporting
- [ ] **Multi-city support** — city selector to scope coordinator dashboards
- [ ] **SMS fallback** — Twilio SMS alerts for volunteers without smartphone data

---

## 🤝 Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

```bash
# Fork the repo, then:
git clone https://github.com/faheemshiledar/Sevak-v1.git
cd Sevak-v1
git checkout -b feature/your-feature-name
git commit -m 'Add: your feature description'
git push origin feature/your-feature-name
# Open a Pull Request at https://github.com/faheemshiledar/Sevak-v1/pulls
```

---

## 📄 License

All rights reserved · © 2025 Faheem Shiledar · Team NIRVANA

---

<div align="center">

Built with ❤️ for emergency responders across India

**SEVAK** · by [Faheem Shiledar](https://github.com/faheemshiledar) · Team NIRVANA

[🚀 Live App](https://sevak2-a403d.web.app) · [📂 Repository](https://github.com/faheemshiledar/Sevak-v1/) · [🐛 Report Issue](https://github.com/faheemshiledar/Sevak-v1/issues)

</div>
