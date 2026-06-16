## Roadmap

### Upcoming

1. **Forward-looking economic calendar in Macro panel**
   - Enhance the existing macro panel prompt to also surface upcoming scheduled macro events (next 60 days): FOMC dates, CPI/PPI releases, Non-Farm Payrolls, GDP prints, PCE
   - Same Gemini + Google Search mechanism, single call producing two sections (recent events + upcoming calendar)
   - Flows to synth as ambient context so derivatives sleeve is aware of upcoming vol events

2. **Per-ticker catalyst panel (new panel)**
   - New "Catalyst" panel (9th panel) using Gemini + Google Search grounding
   - Surfaces upcoming binary events for the specific ticker: earnings, ex-dividend, FDA/PDUFA, product launches, lockup expirations, index rebalancing, analyst days
   - Returns structured meta with event type, date, days away, confirmed/estimated
   - Hard gate in synth: if any confirmed catalyst lands within the standard expiry window (30-45 DTE + 2 day buffer), derivatives sleeve must PASS or shorten expiry
   - Catches the events that the fundamentals panel's `nextEarningsDate` does not cover

### Done

- Support, resistance, and structural change levels (handled by Technical Anomaly panel)
- Web-grounded Stock Digest panel (Gemini + Google Search, short-term sentiment + direction signal)
- Macro Environment panel (backward-looking market-moving events, 6h TTL cache)
- 8-panel architecture (capital, technical, derivatives, news, digest, sentiment, fundamentals, insider)
- Dual-sleeve synth verdict (stock + derivatives) with conservative trader gates