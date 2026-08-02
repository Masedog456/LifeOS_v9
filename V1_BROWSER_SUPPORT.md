# LifeOS V1 — Browser Support

> Provisional draft pending Product Owner sign-off. Release candidate `v1.0.0-rc1`.

We claim support only for browsers we have actually tested. Version 1 targets
**current stable** desktop and mobile mainstream browsers.

## Automated (this environment)

| Engine | Version | Platform | Date | Result |
|---|---|---|---|---|
| Chromium (Playwright) | 141.0.7390.37 | linux-headless | 2026-08-01 | app-shell, capture, help, onboarding, diagnostics — **5/5 flows clean** |

Only headless Chromium can be driven here. All 27 visual-regression surfaces
(desktop + mobile viewports) render clean with **no horizontal overflow** on
Chromium.

## Manual matrix required before GA

These rows must be run on **real** browsers with a disposable account and
recorded. Do **not** claim support until done.

| Browser | Platform | Tested version | Date | Passed flows | Limitations |
|---|---|---|---|---|---|
| Chrome (stable) | desktop | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Edge (stable) | desktop | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Firefox (stable) | desktop | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Safari (stable) | macOS | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| iOS Safari | iOS | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| Android Chrome | Android | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Unsupported

Internet Explorer, and any browser older than current stable, are **not**
supported. No polyfill/compat guarantees are made for untested engines.

## Suggested manual flows per browser

App shell → sign in → Today → capture → process → project → action → plan →
focus → daily review → import document → citation → maintenance → insights →
search → inspector → export → privacy → diagnostics → sign out → mobile reflow.
Confirm no horizontal overflow on core routes at 320/375/390/430px.
