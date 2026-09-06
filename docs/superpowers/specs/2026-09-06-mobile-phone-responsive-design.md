# Mobile Phone Responsiveness Design

**Date:** 2026-09-06  
**Status:** Approved direction — implementation pending

## Goal

Make every existing XMUM Orientation booking route work naturally in phone portrait view, with a 320px-wide viewport as the functional floor. The desktop visual system, page hierarchy, copy, and all existing flows remain intact.

## Device scope

- **In scope:** mobile browsers in portrait orientation, from 320px through 767px wide; touch interaction; browser safe areas.
- **Out of scope:** tablet-specific layouts, a visual redesign, data/API changes, and changes to booking or staff-management behavior.

## Shared adaptation

The shared header becomes a compact, touch-friendly bar. Public visitors retain direct booking actions in a compact menu; signed-in staff retain profile and sign-out access alongside their role-specific navigation. The menu is keyboard-accessible, reflects its expanded state, closes after navigation, and does not rely on hover.

Global mobile rules will establish `border-box` sizing, protect safe-area edges, prevent accidental horizontal overflow, keep text inputs at a readable 16px size (avoiding iOS zoom), and provide at least 44px touch targets for interactive controls. Existing transitions will respect reduced-motion preferences.

## Public booking flows

The landing, interview selector, booking form, confirmation, booking lookup, and staff authentication screens reduce to a single readable column. Intro actions become full-width or naturally wrap; selectors and filters stack; slot cards remain scannable without clipped venue or capacity labels; two-column confirmation/detail grids become a single column where their content would otherwise crowd.

The booking form keeps its held-seat context visible without locking the user into a desktop-width sidebar. Controls and primary actions remain reachable and retain the existing validation, hold, and confirmation behavior.

## Staff flows

Dashboards, admin management, practice groups, profile, audit log, and interview management retain every action on phone. Existing desktop tables render through their card-list alternatives; missing table variants receive an equivalent card/list treatment. Filter bars, bulk forms, member rows, and header controls stack with full-width actions where that reduces ambiguity. Dialogs become bottom sheets that fit inside the visual viewport and scroll their content independently.

## Verification

Add focused tests for the responsive navigation and shared mobile class contract before modifying production UI. Then build and lint the app, run the test suite, and inspect the public, booking, staff, and modal routes at 320px and 375px phone widths. The final inspection checks no horizontal page scrolling, all primary controls meet touch size, no core action is hidden, and menus/dialogs remain usable with keyboard and touch.
