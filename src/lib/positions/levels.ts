// Live-levels breach evaluation, shared by the Held-Options detail card and the
// left-rail Options panel. A credit spread's risk lives in its SHORT leg: the
// short strike is FIXED (it's the contract you sold), while the expected-move
// bound and support/resistance DRIFT and are what cross it. A short put is
// threatened from below (EM.lower / support); a short call from above
// (EM.upper / resistance). Pure logic — no React, no fetching.

import type { HeldGroup } from "./types";
import type { LevelsSnapshot } from "../types";

export type LevelTone = "ok" | "watch" | "breached";

export interface ShortLegStatus {
  conid: number;
  side: "P" | "C";
  strike: number;
  emBound: number | null;    // EM.lower (put) or EM.upper (call) — the moving bound nearing the strike
  emInside: boolean;         // the expected-move bound has reached/passed the strike (statistically exposed)
  level: number | null;      // support (put) or resistance (call)
  levelBreached: boolean;    // the structural level has reached/passed the strike
  itm: boolean;              // spot itself has crossed the short strike — already in the money
  tone: LevelTone;
}

export function evalShortLegs(g: HeldGroup, snap: LevelsSnapshot): ShortLegStatus[] {
  const spot = snap.spot;
  const em = snap.expectedMove;
  return g.legs
    .filter((l) => l.assetClass === "OPT" && l.position < 0 && l.putOrCall && l.strike != null)
    .map<ShortLegStatus>((l) => {
      const strike = l.strike as number;
      if (l.putOrCall === "P") {
        const emBound = em?.lower ?? null;
        const emInside = emBound != null && emBound <= strike;
        const level = snap.support;
        const levelBreached = level != null && level <= strike;
        const itm = spot != null && spot <= strike;
        // "inside" (watch) is tied to the EXPECTED MOVE only: it fires once the
        // EM bound has crossed the short strike. A support/resistance breach is
        // still surfaced (levelBreached) for context, but it no longer flips the
        // tag on its own — that kept "inside" meaning two different things.
        const tone: LevelTone = itm ? "breached" : emInside ? "watch" : "ok";
        return { conid: l.conid, side: "P", strike, emBound, emInside, level, levelBreached, itm, tone };
      }
      const emBound = em?.upper ?? null;
      const emInside = emBound != null && emBound >= strike;
      const level = snap.resistance;
      const levelBreached = level != null && level >= strike;
      const itm = spot != null && spot >= strike;
      const tone: LevelTone = itm ? "breached" : emInside || levelBreached ? "watch" : "ok";
      return { conid: l.conid, side: "C", strike, emBound, emInside, level, levelBreached, itm, tone };
    });
}

// Worst tone across a group's short legs — drives a single row indicator.
export function worstTone(statuses: ShortLegStatus[]): LevelTone {
  if (statuses.some((s) => s.tone === "breached")) return "breached";
  if (statuses.some((s) => s.tone === "watch")) return "watch";
  return "ok";
}
