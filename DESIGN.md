# Flight Lens Apple + React Bits Glass Design Contract

This document is the implementation contract for the Flight Lens web rewrite. It
maps the referenced Apple design analysis, the user-supplied React Bits
`GlassSurface` implementation, and Emil Kowalski motion rules onto the existing product behavior. It does not
change API or domain contracts.

## 1. Existing Business State Map

```text
Search workspace
  idle
    -> conversational input -> parsing
      -> ready -> editable parsed summary -> searching
      -> incomplete -> precise form with known fields preserved
      -> parse failure -> inline actionable error
    -> precise form -> local validation
      -> invalid location/date/constraints -> inline actionable error
      -> valid -> searching

Searching
  -> Edge Companion absent -> cloud API request
  -> Edge Companion present -> companion evidence + cloud API request
  -> per-source pending/searching
  -> response
    -> offers -> results workspace
    -> honest empty -> empty result with source completion evidence
    -> request failure/timeout -> failure state without fabricated prices

Results workspace
  -> production / sandbox / fresh-cache / stale-cache disclosure
  -> single-source warning when applicable
  -> sort + filter + grouped itinerary scan
  -> offer selection -> quote detail
  -> price judgment -> price center
  -> connector evidence -> coverage center
  -> save -> authenticated account or login-required message

Quote detail
  -> segments + price components + FX + baggage + change/refund rules
  -> exact-offer or search-results handoff disclosure
  -> split-ticket risk disclosure when applicable
  -> source re-verification link

Price center
  -> 30/90/180 day external market history
  -> site observations kept as a separate series
  -> unavailable history remains blank, never synthesized
  -> alert list/create/pause/resume/delete/test
  -> scheduler unavailable disclosure

Coverage center
  -> connector state: success / empty / timeout / rate-limited / auth / login /
     captcha / page-changed / provider / invalid / unavailable / unsupported
  -> timing, offer count, retry/cache/nearby-airport notes
  -> Edge Companion and cloud API capability boundaries

Account center
  -> login / register / forgot password / reset / email verification
  -> profile + current/all-device sign-out + session revocation
  -> preferences + notifications + history + saved itineraries
  -> anonymous data migrate / skip / delete
  -> export / account deletion
```

## 2. Information Architecture

| View | Single responsibility | Primary entry | Primary exit |
| --- | --- | --- | --- |
| Search workspace | Define and validate itinerary and preferences | Product root | Search results |
| Search results | Filter, sort, scan, compare, and select | Completed search | Quote detail |
| Quote detail | Explain one quote's total, rules, and evidence | Selected result | Seller handoff / results |
| Price center | Explain price history and manage alerts | Result price judgment | Results |
| Coverage center | Explain source capability, state, and limits | Global utility / result evidence | Previous view |
| Account center | Manage identity and personal data | Global account utility | Previous view |

All views share one client-side search context. Existing endpoints and contract
objects remain authoritative. A view may be rendered as a desktop workspace or
mobile sheet, but its responsibility does not change.

## 3. Apple Token And Component Mapping

### Color

| Project token | Apple source token | Value | Use |
| --- | --- | --- | --- |
| `--action` | `colors.primary` | `#0066cc` | Only interaction color |
| `--action-focus` | `colors.primary-focus` | `#0071e3` | Focus ring |
| `--action-dark` | `colors.primary-on-dark` | `#2997ff` | Links on dark surfaces |
| `--ink` | `colors.ink` | `#1d1d1f` | Text on light surfaces |
| `--muted` | `colors.ink-muted-48` | `#7a7a7a` | Secondary text |
| `--canvas` | `colors.canvas` | `#ffffff` | Main surface |
| `--parchment` | `colors.canvas-parchment` | `#f5f5f7` | Alternating surface |
| `--tile` | `colors.surface-tile-1` | `#272729` | Dark decision surface |
| `--hairline` | `colors.hairline` | `#e0e0e0` | Utility separation |

Status colors are semantic text/border accents, not competing brand colors.
They must never replace Action Blue for interaction.

### Type, spacing, and shape

- Display: `SF Pro Display, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`.
- UI/body: `SF Pro Text, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`.
- Headings use weight 600, never routine 700. Body is 17px/400/1.47.
- Fixed type steps come from the Apple document: 56, 40, 34, 28, 21, 17, 14,
  12, and 10px. Responsive breakpoints switch steps; font size never tracks
  viewport width continuously.
- Structural spacing uses 4, 8, 12, 17, 24, 32, 48, and 80px.
- Utility controls use 8px radius; high-value containers may use 18px; primary
  CTA, search, and compact choice chips use pill radius. Full-width bands are 0px.
- Every interactive target is at least 44 by 44px.
- No decorative gradients, card chrome shadows, nested cards, or oversized
  marketing hero. Surface changes provide hierarchy.

### Components

| Product component | Apple component mapping |
| --- | --- |
| Primary search / handoff action | `button-primary` pill |
| Secondary command | `button-secondary-pill` |
| Dense filter/sort controls | `button-dark-utility` / 8px utility grammar |
| Search input | `search-input` pill grammar, adapted for multiline text |
| Global workspace navigation | compact gray-white frosted navigation + translucent utility layer |
| Search summary / result toolbar | `floating-sticky-bar` material behavior |
| Result and account rows | flat utility rows with hairlines, not card walls |
| Full-width sections | light / parchment / near-black product-tile rhythm |

## 4. React Bits GlassSurface Plan

Only a few important surfaces use refraction. Each instance owns one uniquely
identified SVG filter and observes only its own bounds.

```text
navigation-brand-root
  transparent-scene-layer           (reveals and refracts the live page below)
  React Bits GlassSurface           (brand capsule)

navigation-controls-root
  transparent-scene-layer           (reveals and refracts the live page below)
  React Bits GlassSurface           (navigation controls)

search-primary-action-root
  transparent-scene-layer           (reveals and refracts the live page below)
  React Bits GlassSurface           (primary search button)

result-status / summary roots
  transparent-scene-layer           (reveals and refracts the live page below)
  React Bits GlassSurface           (compact result surfaces)
```

Rules:

- The scene sibling is transparent. The browser therefore refracts the real
  page content beneath each floating surface and its appearance changes with
  scrolling; no solid, patterned, or decorative scene is inserted behind it.
- Every instance generates unique filter, gradient, and displacement-image IDs;
  several surfaces can therefore coexist without sharing SVG state.
- A `ResizeObserver` refreshes the displacement map only when the surface bounds
  change. No frame loop or DOM screenshot is used.
- Chrome-compatible browsers apply the three-channel SVG displacement filter.
  Unsupported engines expose `data-glass-fallback="svg-filter-unsupported"`
  and retain the same readable layout with a solid/translucent material.
- `prefers-reduced-transparency: reduce` skips initialization and uses solid
  white/near-black surfaces. `prefers-contrast: more` adds explicit borders.
- Root and SVG-filter counts are asserted in E2E. Active surfaces must contain
  one filter and three `feDisplacementMap` nodes, with no rendering canvas.
- Initialization never gates search and the visible fallback has the same hit
  targets, focus behavior, and contrast as the enhanced surface.

## 5. Motion Table

| Location | Purpose | Frequency | Properties | Curve | Duration | Reduced motion |
| --- | --- | --- | --- | --- | --- | --- |
| Pointer press | Feedback | Tens/day | `transform` | `--ease-out` | 140ms | Keep subtle scale/color feedback |
| Search parse state | State indication | Occasional | `opacity` | `--ease-out` | 180ms | Opacity only |
| Results first reveal | Prevent jarring change | Occasional | `opacity`, `transform` | `--ease-out` | 240ms | Opacity only |
| Triggered overlay morph | Spatial consistency | Occasional | lightweight morph layer `opacity`, `transform`, `border-radius` from trigger bounds | GSAP `sine.inOut` to `power3.out` | 360ms | Hide morph; reveal final panel |
| Overlay content | Prevent jarring change | Occasional | `opacity`, `transform` | GSAP `power3.out` | 260ms | Opacity only |
| Result navigation split | Preserve result reading space | Occasional | `opacity`, `transform`, bounded capsule size | `--ease-drawer` | 520ms | Instant geometry; keep opacity/color |
| Segmented control indicator | State indication | Tens/day | `transform` | `--ease-in-out` | 200ms | Instant position, keep color |
| Tooltip first open | Explanation | Occasional | `opacity`, `transform` | `--ease-out` | 125ms | Opacity only; adjacent tooltips instant |
| Keyboard navigation/sort | None | High | none | none | 0ms | Same |
| Price charts | Functional data | High | none | none | 0ms | Same |

Shared curves:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

No `transition: all`, `ease-in`, `scale(0)`, layout-property animation, or
decorative high-frequency keyframe animation is allowed. Hover motion is gated
behind `(hover: hover) and (pointer: fine)`.

## 6. Keep, Merge, Delete

| Decision | Existing capability/section | Reason |
| --- | --- | --- |
| Keep | Conversational parsing and editable exact form | Core input paths share one intent |
| Keep | All route/date/passenger/cabin/budget/stop/red-eye/baggage/nearby filters | Required search contract |
| Keep | Honest progress, empty, error, timeout, cache, and source states | Trust and operational truth |
| Keep | Sorting, filters, grouping, price/baggage/refund/change evidence | Core comparison workflow |
| Keep | Price judgment/history/alerts | Required decision support |
| Keep | Auth, recovery, verification, sessions, preferences, notifications, history, saves, migration/export/delete | Required account boundary |
| Merge | Top-bar coverage, trust row, result side card, coverage modal | One coverage center plus contextual status |
| Merge | Summary cards and result badges | One scan-first result summary |
| Delete | Marketing hero and four principle cards | Duplicate explanation before the user's task |
| Delete | Inline expanded quote detail | Quote detail receives its own responsibility |
| Delete | Repeated “not a seller” copy | Keep once at handoff/evidence boundary |

## 7. Verification Matrix

| Area | Verification |
| --- | --- |
| Viewports | 390, 640, 834, 1024, 1440px screenshots and overflow assertions |
| Search | conversational ready/incomplete/failure; exact form validation and payload |
| Results | success, honest empty, failure, timeout, cache, sorting/filtering/grouping |
| Quote | components, FX, baggage, refund/change, evidence, split-ticket, handoff |
| Price | judgment available/unavailable, 30/90/180 history, alert lifecycle/scheduler |
| Coverage | all connector states, Edge/cloud boundary, focus trap and Escape |
| Account | auth modes, verification, recovery, session controls, personal data flows |
| Keyboard | visible focus, tab order, roving tabs, Escape close, trigger focus restore |
| Media preferences | reduced motion, reduced transparency, increased contrast |
| GlassSurface | active SVG filter, forced unsupported fallback, three displacement channels, no canvas, visible fallback |
| Performance | bounded SVG filters/observers, no frame loop or DOM capture, no console errors, no layout shift |
| Quality gates | TypeScript, ESLint, unit tests, build, Playwright, axe |

Breakpoints follow the Apple source priorities: 1440, 1068, 833, 734, 640,
and 419px. The required validation points are a subset plus 1024px.
