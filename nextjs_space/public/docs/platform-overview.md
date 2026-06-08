# Launch Marketing — Platform Overview

## What We Do

Launch Marketing is an AI-powered marketing platform that turns a single website URL into a complete digital marketing presence. We handle social media content creation, search engine optimization, Google Ads copy, and ongoing performance reporting — so business owners can focus on running their business instead of managing their marketing.

The platform is built around two connected systems:

- **Ad Launch** (connect.launchmarketing.com) — the client-facing web application where businesses onboard, review content, manage their social queue, and access reports.
- **Tombstone** — the backend operations engine that powers content research, creative production, quality control, and campaign data pipelines.

---

## Social Post Creation

When a client enters their website URL, the platform analyzes their business and produces ready-to-post social media creatives. Each generation run delivers **3 unique posts**, each built from a different content angle:

| Content Angle | Source | Example |
|---|---|---|
| **Website / Brand** | The client's own website — services, products, team, differentiators | "Family-owned since 1987 — see why Denver trusts ABC Plumbing" |
| **Local News & Events** | Hyper-local news stories relevant to the business's trade area | "The new downtown park opens Saturday — we'll be there. Will you?" |
| **Upcoming Holidays & Seasonal** | National holidays, observances, and seasonal hooks tied to the business | "Small Business Saturday is next week — here's how to support local" |

Each post includes:
- A custom AI-generated image sized for Facebook/Instagram
- Platform-ready caption with hashtags
- A call-to-action matched to the business category
- Source attribution (for news-based posts)

### Social Post Queue

Once generated, posts land in the client's **Social Post Queue** inside the dashboard. From the queue, clients can:

- **Review & approve** each post before it goes live
- **Edit captions** or request image regeneration
- **Schedule or publish** directly to connected social accounts
- **Track status** — pending approval, scheduled, published, or rejected
- **Filter by business** when managing multiple locations

### Daily Scout Report

For clients on an ongoing plan, the platform sends a **Daily Scout Report** via email. The Scout:

- Scans the client's local news feeds and interest categories every morning
- Curates the most relevant stories with suggested post angles
- Delivers a summary email with one-click links to approve stories for post creation
- Tracks which stories have been used and which are still available

The Scout email includes a magic link — no login required to review and select stories. Selected stories are queued for full creative production automatically.

### Content Source Preferences

Clients control their content mix through **Feed Preferences**:

- **Local Only** — hyper-local news from their ZIP code / trade area plus upcoming events
- **Local + Interests** — local news combined with national trending content from selected industry categories
- **Interests Only** — national/interest feeds with no local ZIP requirement

Industry categories include Restaurant & Food, Real Estate, Healthcare, Legal, Home Services, Fitness, Automotive, Technology, Retail, and more.

---

## SEO Insights

Every analysis includes a **live SEO audit** of the client's website. The audit checks 15+ ranking factors and produces an overall score (A through F) with specific findings in each category:

| Category | What's Checked |
|---|---|
| **Security & Performance** | HTTPS, server response time, HTTP status |
| **On-Page SEO** | Title tag (presence + length), meta description, H1 structure, content word count |
| **Mobile & Social** | Viewport meta tag, Open Graph tags |
| **Technical SEO** | Canonical tag, robots.txt, XML sitemap, structured data (Schema.org) |
| **Content Quality** | Image alt text coverage, internal linking, overall content depth |

Each finding is rated **Pass**, **Warning**, or **Fail** with a plain-English explanation of what it means and why it matters. The score is weighted — critical issues like missing HTTPS or no title tag count more than minor warnings.

The SEO section is collapsible in the results view and shows the letter grade in the header so clients can see their score at a glance.

---

## Google Ads (Search Ad Copy)

The platform generates **ready-to-use Google Search Ad copy** as part of every analysis. This gives clients a head start on paid search without needing to write ads from scratch.

Each Google Ads package includes:

- **Headlines** — Multiple responsive search ad headlines (under 30 characters each), validated for completeness and relevance
- **Descriptions** — Two ad descriptions (under 90 characters each) with clear value propositions and calls to action
- **Keywords** — A curated list of business-specific search keywords, filtered for quality and relevance
- **Display URL path** — Suggested URL paths for the ad display

All copy is generated with the business name, category, location, and services already baked in — no generic placeholders or "Unknown" values.

Copy-to-clipboard buttons are available on every element so clients can paste directly into Google Ads Manager.

### Google Ads Performance Reporting (Managed Accounts)

For clients whose Google Ads accounts are managed through Launch Marketing's MCC (My Client Center), the platform provides **automated performance reporting**:

- **Daily metric sync** — Campaign-level data is pulled automatically every day, including spend, impressions, clicks, CTR, average CPC, conversions, cost per conversion, conversion rate, and impression share metrics
- **KPI anomaly detection** — The system monitors 11 key performance indicators and flags unusual changes using statistical analysis. Alerts are categorized as warnings or critical based on how far a metric deviates from its historical baseline
- **Sync run history** — A full log of every data sync, including success/failure status and error details
- **Manual sync** — On-demand data pulls for any specific date, useful for spot-checking or backfilling

Reporting data is accessible through the dashboard and via API for integration with external reporting tools.

---

## Reporting & Analytics

The platform provides reporting at multiple levels:

### Per-Analysis Report
Every URL analysis produces a comprehensive results page containing:
- 3 social media creatives with preview mockups
- Google Search Ad copy package
- SEO audit with score and detailed findings
- 90-day posting plan with weekly themes and event integration
- Website concept brief (for clients interested in a site redesign)

### Dashboard Analytics
The client dashboard provides:
- **Post queue metrics** — posts by status (pending, approved, published, rejected)
- **Business overview** — all connected businesses with their current state
- **Generation history** — past analyses and their outputs
- **Credit balance** — remaining credits and usage tracking

### Daily Scout Reports
Automated daily email digests (described above) that serve as both a content curation tool and a reporting touchpoint showing what's happening in the client's local market.

### Google Ads Reports
For managed ad accounts:
- Campaign performance trends over time
- Anomaly alerts when metrics deviate significantly from baseline
- Sync status and data freshness indicators

---

## How It All Connects

```
 Client enters URL
      │
      ▼
 ┌─────────────┐
 │  Analysis    │──▶ SEO Audit (live scan)
 │  Engine      │──▶ Google Ads Copy (generated)
 │             │──▶ Posting Plan (90-day calendar)
 │             │──▶ Website Concept Brief
 └──────┬──────┘
        │
        ▼
 ┌─────────────┐
 │  Creative    │──▶ 3 Social Posts (image + caption + CTA)
 │  Production  │──▶ Quality review before delivery
 └──────┬──────┘
        │
        ▼
 ┌─────────────┐
 │  Dashboard   │──▶ Social Post Queue (review/edit/publish)
 │             │──▶ Feed Preferences (content sources)
 │             │──▶ Scout Reports (daily email digest)
 │             │──▶ Google Ads Reporting (managed accounts)
 └─────────────┘
```

---

## Client Deliverables Summary

| Deliverable | Frequency | Included In |
|---|---|---|
| 3 social media creatives | Per analysis run | Free tier + paid |
| Google Search Ad copy | Per analysis run | Free tier + paid |
| SEO audit & score | Per analysis run | Free tier + paid |
| 90-day posting plan | Per analysis run | Free tier + paid |
| Website concept brief | Per analysis run | Free tier + paid |
| Daily Scout Report email | Daily (when enabled) | Paid plans |
| Social post queue management | Ongoing | Paid plans |
| Google Ads performance reporting | Daily sync | Managed accounts |
| KPI anomaly alerts | Continuous | Managed accounts |
