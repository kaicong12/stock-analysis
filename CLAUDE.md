---
name: Institutional Intelligence
colors:
  surface: '#051424'
  surface-dim: '#051424'
  surface-bright: '#2c3a4c'
  surface-container-lowest: '#010f1f'
  surface-container-low: '#0d1c2d'
  surface-container: '#122131'
  surface-container-high: '#1c2b3c'
  surface-container-highest: '#273647'
  on-surface: '#d4e4fa'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#d4e4fa'
  inverse-on-surface: '#233143'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#7bd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#001a27'
  on-tertiary-container: '#008abb'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#051424'
  on-background: '#d4e4fa'
  surface-variant: '#273647'
typography:
  display-lg:
    fontFamily: Work Sans
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Work Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-sm:
    fontFamily: Work Sans
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  data-tabular:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 24px
  gutter-dense: 12px
  gutter-standard: 20px
  component-padding-x: 16px
  component-padding-y: 12px
---

## Trading Profile & Strategy Guidelines

The user is a **conservative options/derivatives trader**. All features, screeners, and strategy tooling built in this project must respect the following constraints:

- **Underlying quality:** Only trade derivatives on large-cap tickers ($10B+ market cap). Explicitly exclude meme stocks, penny stocks, and speculative low-cap instruments.
- **Exchange filter:** Restrict to major US exchanges (NYSE, NASDAQ) via `locationCode = "STK.US.MAJOR"` in IBKR scanner calls.
- **Liquidity minimums:** Enforce `abovePrice = 20`, `aboveVolume = 500,000` (daily), and `optVolumeAbove = 1,000` on all scanner queries.
- **Preferred strategies:** Credit spreads and iron condors in high IV Rank (>50) environments. No naked options or unlimited-risk positions.
- **IV filter:** Use `HIGH_OPT_IMP_VOLAT_OVER_HIST` as the primary scan code. IVR > 50 required; IVR > 70 preferred.
- **No binary events:** Never suggest entering a position when earnings, FDA, or FOMC dates fall within the expiration window.
- **Broker:** Interactive Brokers (IBKR) — Client Portal API and TWS API.

## Brand & Style
This design system is built for high-stakes financial environments where authority and clarity are paramount. The brand personality is institutional yet innovative—think of it as a digital translation of a premium private equity firm. The design style follows a **Corporate / Modern** aesthetic, prioritizing data density and structural integrity over decorative elements. It utilizes a high-contrast dark environment to reduce eye strain during prolonged analysis and to make vibrant financial indicators pop. The overall emotional response should be one of absolute confidence, precision, and "Alpha" level insight.

## Colors
The palette is rooted in a deep "Midnight Navy" foundation to establish an authoritative tone. Charcoal and Slate layers are used to differentiate information hierarchies within the interface. 

- **Primary & Secondary:** These define the "Terminal" feel, using dark, desaturated blues to create a focused workspace.
- **Semantic Accents:** Emerald Green and Crimson are reserved strictly for trend indicators (bullish/bearish), ensuring that the most critical data points—price movement and volatility—are immediately scannable.
- **Neutral Scale:** A refined range of cool grays is used for secondary data, captions, and borders to maintain a clean, uncluttered look despite high information density.

## Typography
Typography is treated as a functional tool. **Inter** is the primary workhorse, selected for its exceptional legibility in dense data tables and its neutral, systematic character. **Work Sans** is used for headlines to provide a slightly more grounded, professional weight to the institutional branding.

- **Tabular Lining:** All data-heavy components must use tabular lining figures to ensure that numbers align perfectly in columns for quick vertical scanning.
- **Hierarchy:** High contrast in font weight (Regular vs. Medium/Semi-Bold) is preferred over large jumps in font size to maintain high density without sacrificing clarity.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy within a 12-column system, optimized for large-format displays (1440px+). 

- **Density:** We utilize a 4px baseline grid to allow for a "Compact" mode. In financial analysis, seeing more data at once is often more valuable than excessive white space.
- **Modules:** Content is organized into modular "Panes." Each pane should be treated as a self-contained unit of intelligence, separated by consistent gutters.
- **Alignment:** Strict horizontal and vertical alignment is required for table headers and chart axes to create a sense of mechanical precision.

## Elevation & Depth
This design system avoids traditional shadows to keep the interface feeling flat, fast, and modern. Depth is instead communicated through **Tonal Layers** and **Low-Contrast Outlines**.

- **Surface Levels:** The base background is the darkest shade (Primary). Elevated components like cards or modal overlays use a slightly lighter shade (Secondary) to "lift" them.
- **Borders:** Subtle 1px borders in a muted Slate-800 color provide structural definition between panes without the visual noise of heavy drop shadows.
- **Active State:** Focus or active states are indicated by a thin, vibrant primary-color glow or border, rather than a physical lift.

## Shapes
The shape language is disciplined and professional. We use **Soft (1)** roundedness (4px) for most UI elements. This provides a modern touch that feels engineered and refined, avoiding the "playfulness" of highly rounded corners or the "dated" look of perfectly sharp edges.

- **Buttons & Inputs:** Use the standard 4px radius.
- **Data Points:** In charts, markers should be crisp circles or sharp squares to ensure precision on the pixel grid.
- **Selection States:** Use subtle, rounded background fills to highlight rows or menu items.

## Components
### Data Visualizations
Charts should utilize a minimal aesthetic. Grid lines must be faint and desaturated. Use a "Focus Line" on hover that snaps to data points, displaying precise values in a high-contrast tooltip.

### Ticker Cards
Ticker cards must display the symbol, current price, and a "mini-sparkline." The sparkline color should dynamically switch between Emerald and Crimson based on the 24h change.

### Confidence Score Gauges
Gauges use a semi-circular radial track. The needle or "fill" should be color-coded: Crimson for high risk, Amber for neutral, and Emerald for high confidence. Use a bold, centered percentage for the core metric.

### News Feeds
News items are styled as high-density lists. Headlines are prioritized, with a timestamp and a "Sentiment Tag" (a small, low-opacity colored chip) indicating the likely market impact of the news.

### Buttons & Inputs
Buttons are primarily "Ghost" or "Outline" styles to keep the UI light. The Primary Action button uses a solid deep-blue fill with white text. Inputs are "filled-style" using a dark Slate background and a 1px border that brightens on focus.