# Download Money Rebrand Checklist

Last updated: 2026-05-10
Owner: AI Agent + Product Team

## Objective

Rebrand frontend copy and core UI identity from "Crypto Analyzer" to "Download Money" while keeping current trading functionality stable.

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked

## Phase 1 - Core Brand Surface (Highest Priority)

- [x] Update global app metadata (`title`, `description`, `keywords`) in `frontend/app/layout.tsx`
- [x] Update top navigation branding and subtitle in `frontend/app/layout/Header.tsx`
- [x] Update footer disclaimer/supporting copy in `frontend/app/layout/Footer.tsx`
- [x] Update home loading/error language in `frontend/app/page.tsx`

## Phase 2 - Product Copy Consistency

- [x] Update hero section titles/subtitles in `frontend/app/sections/HeroSection.tsx`
- [x] Rename prediction wording to new product language in `frontend/app/sections/PredictionsSection.tsx`
- [x] Review positions/pending/history labels for brand voice consistency
- [x] Update rules pages wording (`frontend/app/rules/*`)

## Phase 3 - Visual Identity

- [x] Confirm logo/icon treatment in header (keep Zap or replace)
- [x] Update accent text/marketing tone in key cards
- [x] Validate dark/light mode visual consistency after copy updates

## Phase 4 - QA and Release

- [x] Verify desktop and mobile layouts for text overflow/regression
- [x] Verify all key pages with real API data
- [x] Verify refresh, trigger analysis, and pagination behavior
- [x] Create release note for rebrand update

## Notes / Decisions

- Domain target: `download-money-moi.vercel.app`
- Keep trading engine and backend routes unchanged in this rebrand scope.
- Start implementation from Phase 1 in current session.
