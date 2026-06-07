# Plan: Remove the Contract-Picker Feature

## Goal

Fully remove the LLM-driven "contract picker" — the stage that takes a directional
verdict plus a live option chain and returns a concrete `ContractPick` (specific
legs, strikes, expiries, sizing). After this change the app stops at the
**verdict** (directional + strategy read); it no longer proposes executable
contracts. Trade logging via the journal (`close-held` flow) is unaffected.

## Why this is safe to remove cleanly

The picker is a leaf in the data flow: verdict → (optional) pick. Nothing
downstream consumes a `ContractPick` except UI rendering and the order-logging
modal. There is no persistence of picks and no other server route depends on the
picker module.

---

## Dependency inventory

### A. Feature core — delete entirely
| File | Notes |
|------|-------|
| `src/lib/gemini/contract-picker.ts` (~882 lines) | `pickContract`, `pickerEligible`, `RawRollPlan`, prompt construction, roll-plan assembly. Imported **only** by the API route. |
| `src/app/api/contract-pick/route.ts` (~128 lines) | `POST /api/contract-pick`. Only caller is `page.tsx`. |

### B. Types — `src/lib/types.ts`
| Symbol | Action | Reason |
|--------|--------|--------|
| `ContractPick` (501–538) | Delete | Only the picker flow produces/consumes it. |
| `RollPlan` (490–499) | Delete | Used only by `ContractPick.rollPlan` and the picker. |
| `ContractLeg` (466) | **Verify, then delete** | Referenced in `types.ts`, `contract-picker.ts`, `VerdictCard.tsx` only (all pick-flow). Confirm it is not part of the `getNarrowOptionChain` return type before deleting. |
| `SleeveVerdict.contractPick?` (544) | Delete the field | Optional; removing it leaves the verdict shape intact. |

### C. Frontend consumers
- **`src/app/page.tsx`**
  - Remove `ContractPick` import.
  - State: drop `pickError` field; remove `"picking"` from the `status` union.
  - Actions: remove `pick_loading` and `pick_done` variants + their reducer cases.
  - Flow: delete the `eligibleActions` set and the `/api/contract-pick` fetch block (~349–380). After `verdict_done`, transition straight to `status: "done"`.
  - Props: stop passing `isPickLoading` / `pickError` to `VerdictCard` (~492–493) and drop the `"picking"` render branch (~507).
  - Remove `nextEarningsDate` plumbing **only if** it exists solely to feed the picker (it is forwarded from fundamentals → pick; confirm no other reader).
- **`src/app/components/VerdictCard.tsx`**
  - Remove `ContractPick` / `ContractLeg` imports and the `isPickLoading` / `pickError` props.
  - Delete pick-only subcomponents: `ContractPickCard`, `RollPickCard`, `ContractPickError`, `ContractPickSkeleton`, `EarningsBanner`, `ContractLegRow`, and helpers `popFromPick`, `executableLegPrice`.
  - Remove the `sleeve.contractPick` render block (~190–195) and the two `OrderModal` mounts for `open-pick` / `roll` (~417, ~479).
- **`src/app/components/OrderModal.tsx`**
  - Remove `ContractPick` import and the `open-pick` and `roll` intent variants.
  - Delete helpers tied to those intents: `strategyFromPick`, `legsForJournal`, `deriveMgmtProfit`, `deriveMgmtLoss`, `pickExpiry`.
  - **Keep** the `close-held` intent and everything it needs — that is the surviving journal-logging path.

### D. Comments / docs (no logic)
- `src/lib/gemini/synth.ts` — comments at ~80, ~610, ~704 reference the downstream picker. Update wording; no code change.
- `README.md` — remove the `POST /api/contract-pick` → Picker → `contractPick` nodes from the architecture diagram (~133–135).

### E. Shared modules — keep, but verify usage
- `src/lib/moomoo/options.ts` (`getNarrowOptionChain`, `NarrowChainOptions`): imported by both the route **and** `src/lib/positions/prepare.ts`. Keep the module. After deleting the route, check whether `getNarrowOptionChain` / `NarrowChainOptions` are still referenced; if `prepare.ts` uses different exports, mark the now-unused ones for a follow-up (don't delete blindly — leave them or remove only if provably dead).

---

## Execution order (each step compiles independently)

1. **page.tsx** — remove the fetch + reducer/state/status wiring. This severs the only call to the route.
2. **OrderModal.tsx** — drop `open-pick`/`roll` intents + helpers; keep `close-held`.
3. **VerdictCard.tsx** — remove pick subcomponents, props, and OrderModal mounts.
4. **Delete** `src/app/api/contract-pick/route.ts`.
5. **Delete** `src/lib/gemini/contract-picker.ts`.
6. **types.ts** — remove `ContractPick`, `RollPlan`, the `contractPick?` field, and `ContractLeg` (after the §B verification).
7. **Comments/docs** — `synth.ts` and `README.md`.
8. **options.ts** — verify/clean per §E.

---

## Verification

- `pnpm tsc --noEmit` (or the project's typecheck) — must be clean; this surfaces any missed `ContractPick`/`ContractLeg` reference.
- `pnpm lint` — catches unused imports/vars left behind.
- `pnpm build` — confirms the deleted route doesn't break Next.js route collection.
- Manual smoke: run a ticker search end-to-end and confirm the verdict renders and the flow ends at `done` with no console/network calls to `/api/contract-pick`.
- Confirm the journal `close-held` modal still opens and logs a trade.
- `grep -rn "contract-pick\|ContractPick\|RollPlan\|pickContract\|contractPick" src` returns nothing (outside intentional history).

---

## Risks & notes

- **`ContractLeg` reuse** — the one type shared with chain/quote rendering. Confirm before deleting (§B); if uncertain, keep it and remove in a follow-up.
- **`nextEarningsDate` plumbing** — verify it has no consumer other than the picker before ripping it out of `page.tsx`/fundamentals forwarding.
- **State machine** — removing `"picking"` shortens the status union; double-check no CSS/loading UI keys off that string.
- **Out of scope** — no changes to verdict generation (`synth.ts` logic), the option-chain fetcher itself, or the journal schema.
