# SEVAK v3 — Setup in 5 Minutes

## 1. Install
```bash
npm install
```

## 2. Configure
```bash
cp .env.example .env.local
# Fill in your Firebase + API keys
```

## 3. Run
```bash
npm run dev
# → http://localhost:3000
```

## 4. Deploy Firestore Rules
```bash
firebase login
firebase deploy --only firestore:rules,storage
```

## 5. Build & Deploy
```bash
npm run build
firebase deploy --only hosting
```

---

## Role Guide

| Role | Pages | Can Do |
|------|-------|--------|
| **citizen** | Dashboard, Report | Report emergencies |
| **volunteer** | Dashboard, Report, Cases, Map | View & update assigned cases |
| **coordinator** | All pages | Assign volunteers, manage all cases |

Register with the role you want — it's set at signup.
To make yourself coordinator: Firestore → users → your UID → set `role: "coordinator"`

---

## API Keys (all optional except Firebase)

| Key | Where | Notes |
|-----|-------|-------|
| Firebase | console.firebase.google.com | Required |
| Groq | console.groq.com | Free. Without it, uses keyword classification |
| Google Vision | console.cloud.google.com | For image analysis |
| Google Speech | console.cloud.google.com | For voice input |
| Google Maps | console.cloud.google.com | For live map page |

**App works without the Google APIs** — it falls back to smart keyword-based classification.
