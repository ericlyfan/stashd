# Stashd — Product Proposal

_Smart Document Inbox for Everyone_

---

## Overview

Stashd is a web-based document organization application that removes the friction between receiving a document and having it properly filed. Users drop in any file — a receipt photo, a scanned contract, a PDF invoice, an insurance form — and Stashd automatically reads it, understands what it is, categorizes it, tags it, and stores it in the right place. No manual sorting, no folder hunting, no forgotten files.

The core premise is simple: **your documents should organize themselves.**

---

## Problem

Most people have documents scattered across their desktop, downloads folder, email attachments, phone camera roll, and various cloud services. When they need something — a warranty document, last year's tax receipt, a lease agreement — they spend 10–20 minutes hunting for it. The problem isn't storing documents; it's that organizing them manually is tedious enough that most people never do it consistently.

Existing solutions fall short:

- **Google Drive / Dropbox** — generic cloud storage with no intelligence; you still have to create folders and name files yourself
- **Apple Files / Windows Explorer** — purely manual, no understanding of content
- **Expensify / Dext** — narrowly focused on receipts/expenses only
- **Notion** — powerful but requires setup, maintenance, and technical comfort
- **Evernote** — dated UX, limited file type support, no true auto-categorization

There is no general-purpose, AI-powered document inbox that just works for any type of document without configuration.

---

## Solution

Stashd provides a universal document inbox with an AI layer that handles all classification and organization automatically.

### Core User Flow

1. **Drop** — User uploads one or more files via drag-and-drop or file picker (supports PDF, JPG, PNG, HEIC, DOCX, and more)
2. **Process** — AI reads the document content and infers category, tags, key dates, amounts, parties involved, and a plain-language summary
3. **File** — Document is stored under the correct category with metadata attached
4. **Retrieve** — User browses by category/folder or searches across all documents by keyword, tag, date, or amount

The entire process from upload to filed takes under 5 seconds per document.

---

## Features

### MVP (Version 1.0)

| Feature                | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| Drag-and-drop upload   | Multi-file upload with progress indicators                          |
| AI auto-categorization | Claude reads content and assigns category + tags                    |
| Auto-generated summary | 1–2 sentence plain-language summary per document                    |
| Key field extraction   | Extracts date, amount, vendor/party, document type where applicable |
| Category/folder view   | Left sidebar navigation by category                                 |
| Document preview       | In-app preview for PDFs and images                                  |
| Full-text search       | Search across document names, summaries, tags, and extracted fields |
| Manual override        | User can reassign category or edit tags after AI classification     |
| Rename & notes         | User can add personal notes to any document                         |

### Version 1.5 (Post-Launch)

| Feature                | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| Custom categories      | User-defined categories in addition to defaults                       |
| Bulk upload            | Drop an entire folder at once                                         |
| Duplicate detection    | Flag when a document appears to already exist                         |
| Expiry alerts          | Flag documents with upcoming expiry dates (insurance, IDs, contracts) |
| Export to Google Drive | One-click sync of a folder or all documents                           |
| Mobile upload          | Upload directly from phone camera (progressive web app)               |

### Version 2.0 (Future Vision)

| Feature                    | Description                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| Voice dump                 | Speak notes or context; AI attaches them to the right document                    |
| Multi-user / shared vaults | Families, small businesses, construction projects share a Stashd workspace        |
| Accountant export          | Generate organized expense reports from receipts by date range                    |
| Document Q&A               | Ask questions across your documents ("What did I spend at Home Depot last year?") |
| Integrations               | Email forwarding inbox, WhatsApp photo drop, Slack bot                            |

---

## Default Categories

Stashd ships with a sensible default category set that covers the majority of personal and small business documents. The AI selects from these, or creates a new one if nothing fits:

- **Receipts & Expenses**
- **Contracts & Agreements**
- **Identity & Personal** _(passports, driver's licenses, SIN)_
- **Insurance**
- **Medical & Health**
- **Property & Construction**
- **Business**
- **Tax & Finance**
- **Legal**
- **Warranties & Manuals**
- **Education**
- **Travel**
- **Other**

---

## AI Layer

### How It Works

Each uploaded document is passed to the Claude API (Anthropic) along with a structured prompt that instructs it to return a JSON object containing:

```json
{
  "category": "Receipts & Expenses",
  "subcategory": "Home Improvement",
  "tags": ["Home Depot", "lumber", "construction"],
  "summary": "Receipt from Home Depot for $312.47 in lumber and fasteners, purchased March 14, 2025.",
  "date": "2025-03-14",
  "amount": 312.47,
  "vendor": "Home Depot",
  "parties": [],
  "confidence": 0.97
}
```

For images (receipts, photos of documents), the file is passed as a base64-encoded image to Claude's vision model. For PDFs and text documents, text is extracted first, then passed to the API.

### Confidence & Fallback

If the confidence score is below a threshold (e.g. 0.75), the document is flagged for user review rather than auto-filed. The user sees a prompt: _"We weren't sure where to put this — does one of these categories fit?"_

---

## Tech Stack

### Frontend

- **React** — component-based UI
- **Tailwind CSS** — styling
- **React Dropzone** — file upload handling
- **PDF.js** — in-browser PDF preview

### Backend

- **Next.js** (API routes) or **Node.js + Express**
- **Supabase** — PostgreSQL database for document metadata + authentication
- **Supabase Storage** — file storage (backed by S3)
- **Anthropic API** — Claude for document classification and extraction

### Infrastructure

- **Vercel** — frontend deployment
- **Supabase** — managed backend + storage
- No custom server infrastructure needed for MVP

### Data Model (simplified)

```
User
  id, email, created_at

Document
  id, user_id, filename, original_name
  storage_path, file_type, file_size
  category, subcategory, tags[]
  summary, date_extracted, amount, vendor
  confidence_score, reviewed (bool)
  created_at, updated_at

Category
  id, user_id, name, color, icon, is_custom
```

---

## Design Direction

Stashd should feel like a **refined, minimal tool** — clean enough to trust with important documents, but warm enough that it doesn't feel corporate. Think: a well-organized physical filing cabinet translated into a digital product.

### Visual Identity

- **Name**: Stashd
- **Tone**: Calm, reliable, quietly smart
- **Aesthetic**: Clean whites and warm off-whites, subtle shadows, clear typographic hierarchy
- **Color**: Neutral base with one strong accent color (TBD — consider deep teal, slate blue, or warm amber)
- **Typography**: A distinctive but readable font pairing — display font for headings, clean sans-serif for body

### Key UI Screens

1. **Dashboard / Inbox** — Recent uploads, quick stats (total docs, categories), search bar
2. **Category View** — Grid or list of documents within a selected category
3. **Document Detail** — Preview pane + AI summary + tags + extracted fields + notes
4. **Upload State** — Drop zone with live processing feedback per file
5. **Search Results** — Filtered view with highlighted matching terms

---

## Target Users

**Primary**

- Individuals who accumulate important documents and want them organized without effort
- Small business owners (freelancers, contractors, sole proprietors) managing receipts, contracts, and invoices
- Homeowners managing property documents, warranties, renovation records

**Secondary**

- Families managing shared documents (medical records, insurance, school documents)
- Students managing academic records, financial aid, housing documents

---

## Monetization (Future)

For MVP, Stashd is free with generous limits to drive adoption. Future tiers:

| Tier     | Price  | Limits                                                                     |
| -------- | ------ | -------------------------------------------------------------------------- |
| Free     | $0/mo  | 50 documents, 500MB storage, default categories                            |
| Personal | $5/mo  | Unlimited documents, 5GB storage, custom categories, expiry alerts         |
| Pro      | $12/mo | Unlimited everything, Google Drive sync, multi-device, priority processing |
| Team     | $25/mo | Shared workspace, up to 5 users, admin controls                            |

---

## Open Questions & Decisions to Make

These are items to resolve before or during development:

1. **Authentication** — Email/password only, or add Google OAuth from day one?
2. **Storage limits for MVP** — What's the free tier cap before needing to think about costs?
3. **File type support** — Start with PDF + images only, or include DOCX/XLSX from launch?
4. **Category customization** — Allow user-defined categories in V1 or lock to defaults?
5. **Mobile experience** — PWA from launch or desktop-first and mobile later?
6. **Onboarding** — Empty state with sample documents, or guided upload flow?
7. **Privacy & security** — Any specific compliance requirements (PIPEDA for Canadian users)?
8. **Naming / branding** — Is "Stashd" final? Domain availability check needed.
9. **Deletion policy** — Soft delete (recoverable) or hard delete?
10. **Export** — Should users be able to export all their data (zip download) from day one?

---

## Build Phases

### Phase 1 — Core MVP (2–3 weeks)

- Auth (Supabase)
- File upload + storage
- AI classification pipeline
- Category/folder view
- Document preview
- Basic search

### Phase 2 — Polish (1–2 weeks)

- Manual category override
- Tags editing
- Personal notes on documents
- Confidence-based review flag
- Empty states + onboarding

### Phase 3 — Growth Features (ongoing)

- Custom categories
- Expiry alerts
- Google Drive export
- Mobile PWA
- Bulk upload

---

_Last updated: April 2026_
_Status: Pre-development — concept & scoping phase_
