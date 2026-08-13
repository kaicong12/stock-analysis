## Trading Profile & Strategy Guidelines

The user is a **long-term investor who wheels the names they want to own** — not an income trader hunting premium. They research a ticker only when they already want to hold it, then use the wheel to enter at a price they choose: sell a cash-secured put at a price they'd be content buying at; if assigned, they own shares they wanted and sell covered calls against them. **Assignment is an accepted outcome, never a failure.**

- **Strategy menu:** cash-secured puts and covered calls only. No spreads, no iron condors, no naked or debit structures.
- **The expected move is the gate.** Strikes are sold *outside* the 1-SD expected move, on both legs. The wheel pane lists only strikes beyond the band; everything inside it is filtered out in code before anything reads the table.
- **Price before premium.** The secondary question is "is this a good price to be assigned at", not "where is premium richest". The acquisition zone answers it, and it labels a strike rather than filtering it — a `rich` label is a warning to weigh, not a veto.
- **Liquidity is not a gate.** Open interest, volume and spread are shown but never filtered on. A thin far-OTM strike is still a legitimate entry.
- **Vol is a bonus, not a gate.** Rich premium means better pay for waiting; thin premium is a *downgrade, not a veto*. Never gate an entry on an IV threshold. True IV Rank is unavailable (no source carries historical implied vol); the app uses a realized-vol percentile and must always label it as a proxy.
- **Weakness is ambiguous, not disqualifying.** A mild breakdown can be the price the wheeler wants — warn, don't block. Only a *severe* breakdown (thesis damage) blocks an entry.
- **No ticker screening.** The user picks tickers themselves. Don't build market-cap, exchange, or liquidity gates on the underlying; per-strike liquidity (a real bid, sane spread, some OI) is still fair game.
- **No binary events:** never suggest an expiry with earnings or FDA dates inside its window — these are dropped in code. **FOMC is marked, not blocked.** The Fed meets roughly every six weeks, so a hard veto would empty almost every 30–45 DTE expiry; a scheduled macro event is also already priced into the IV being paid. Dates come from the Fed's own calendar (`src/lib/wheel/fomc.ts`) and surface as an amber marker on the event runway.
- **No broker integration.** The app has no account, NAV, cash, or position data and must not acquire any. Consequences:
  - Recommendations are **entry-or-pass** on a fresh position. Never advise holding, closing, trimming, or rolling — the app cannot see whether a position exists.
  - **Never state a position size** — no share counts, contract counts, or dollar risk. Annualized yield % is fine; it's size-independent. Sizing happens at the broker.
  - Never assume the user holds shares or cash. Both wheel legs must state their prerequisite as an explicit condition.
  - Don't prescribe defensive exits on the put leg ("close at 21 DTE", "take profit at 50%") — those are income-trader mechanics. If price comes to the strike, taking the shares is the plan.

## Working Style

- **Minimal diffs.** Change only what the task requires. Do not refactor, rename, reformat, or "improve" adjacent code that was not part of the ask.
- **A docstring is the entire comment budget.** One line at the top of each file saying what it is. One line on each function saying what it does. Nothing else — no inline commentary, no block explanations above a statement, no section banners, no narrating code that already reads clearly, no rationale essays.
- A constraint the code genuinely cannot express — an external rule, a non-obvious ordering requirement — may take **one** extra line. If it needs a paragraph, rewrite the code.
- Prefer deleting a comment over updating it.
- **Python:** the sidecar is FastAPI, so response shapes are pydantic models in `python_backend/models.py`, not bare dicts. Routes declare `response_model`.

## UI

Next App Router + React 19, Tailwind v4, **shadcn/ui** (new-york, `src/components/ui`). Build with the installed primitives — Alert, Badge, Button, Card, Input, Progress, Separator, Skeleton, Table, Tooltip — and add from the registry rather than hand-rolling an equivalent. Icons are lucide.

**Tokens live in `src/app/globals.css` and nowhere else.** Raw Midnight Navy values sit on `:root`; `@theme inline` maps them to both the shadcn semantic names (`--color-background`, `--color-card`, …) and the app's own scale (`bg-surface-low`, `text-on-surface-variant`, `border-outline-variant`, `text-bullish`/`bearish`/`neutral`). Never hardcode a hex in a component.

Two cascade constraints that will silently break the layout if changed:

- `html` must stay at `font-size: 16px` — Tailwind's spacing and radius scales are rem-based, so the 4px baseline grid depends on it. Body text size is set on `body` (14px).
- The global reset must stay inside `@layer base`, or it outranks utility classes.

Style: dark-only (no `.dark` block), high density over whitespace, depth from tonal surface layers and 1px `outline-variant` borders — no drop shadows. 4px radius (`rounded`). Inter for body, Work Sans for headings (`font-heading`). Every numeric column gets `tabular-nums`. Emerald/crimson/amber are reserved for direction and risk — never decoration.
