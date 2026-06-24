# Mobile QA Checklist — Launch OS

All UI changes must be verified against this checklist before shipping.

## Viewport Widths to Test

| Width | Device Class |
|-------|-------------|
| 320px | iPhone SE / small Android |
| 360px | Android baseline |
| 375px | iPhone 12 mini / iPhone SE 3 |
| 390px | iPhone 14 / 15 |
| 414px | iPhone Plus / Max |
| 430px | iPhone 14 Pro Max |
| 768px | iPad mini / tablet portrait |
| 1024px | iPad / tablet landscape |
| 1440px | Desktop |

## Launch OS Dashboard Cards

- [ ] No horizontal scrolling at any width above
- [ ] Gradient header cards (Website Concept, SEO Audit, Google Ads, Posting Plan) display title, description, and CTA without overlap
- [ ] CTA buttons stack below title/description on mobile (< 640px)
- [ ] CTA buttons have min-height 44px for tap targets
- [ ] Description text wraps naturally — no single-word column compression
- [ ] Icons remain visible and do not overlap text
- [ ] Chevron expand/collapse indicators remain accessible
- [ ] Card padding adjusts for mobile (px-4 py-3 on mobile, px-6 py-4 on sm+)

## Generated Concept Websites

- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1.0">` present
- [ ] No horizontal scrolling at 320px
- [ ] Hero section stacks cleanly on mobile
- [ ] Navigation collapses or simplifies on mobile (hamburger/stacked)
- [ ] CTA buttons visible, tappable, min 44px height
- [ ] All images responsive: `max-width: 100%; height: auto;`
- [ ] Section padding adjusts for mobile
- [ ] Multi-column sections collapse to single column on mobile
- [ ] Text does not overflow containers
- [ ] No fixed pixel widths > 500px on containers (use max-width)
- [ ] Cards/testimonials/features stack vertically on mobile

## Common Anti-Patterns to Catch

1. **`flex-shrink-0` on wide buttons** inside flex rows — forces siblings to collapse
2. **Missing `min-w-0`** on flex children with text — text won't truncate/wrap
3. **Fixed `width` instead of `max-width`** on containers
4. **`flex-nowrap`** (default) without mobile override — use `flex-wrap` or `flex-col` on mobile
5. **Absolute positioned CTAs** without mobile breakpoint override
6. **Missing `gap`** forcing manual margins that break at narrow widths
7. **`overflow-hidden`** masking layout problems instead of fixing them
8. **Font sizes too large** on mobile — use responsive sizing (text-base sm:text-lg)

## Quick DevTools Test

1. Open Chrome DevTools → Toggle Device Toolbar (Ctrl+Shift+M)
2. Select "Responsive" and drag to each width above
3. Check: no horizontal scrollbar, no overlapping elements, all text readable
4. Check: all buttons clickable (not hidden behind other elements)
