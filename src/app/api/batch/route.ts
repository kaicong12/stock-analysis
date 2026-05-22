import type { NextRequest } from "next/server";
import {
  PANEL_KEYS,
  parseTickers,
  type BatchEvent,
  type BatchTickerPayload,
  type PanelKey,
} from "../../../lib/batch/protocol";
import { runWithConcurrency } from "../../../lib/concurrency";
import { panelError, runPanel } from "../../../lib/gemini/runPanel";
import { synthesizeVerdict } from "../../../lib/gemini/synth";
import { getSnapshot } from "../../../lib/moomoo/sidecar";
import { prepareSharedPortfolio, prepareTickerSubset } from "../../../lib/positions/prepare";
import { normalizeSymbol, ticker as toTicker } from "../../../lib/symbol";
import type { PanelSummary, SnapshotResult, Verdict } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const tickers = parseTickers(request.nextUrl.searchParams.get("tickers") ?? "");
  if (tickers.length === 0) {
    return Response.json({ error: "tickers query param is required" }, { status: 400 });
  }
  if (tickers.length > 50) {
    return Response.json({ error: "max 50 tickers per batch" }, { status: 400 });
  }

  const concurrency = Math.max(1, Math.min(10, Number(process.env.BATCH_CONCURRENCY) || 3));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: BatchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      // Comment-line keep-alives prevent intermediate proxies from timing out
      // the stream during long verdict-synth waves.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // Stream closed — interval clears below in normal shutdown.
        }
      }, 15_000);

      const shared = await prepareSharedPortfolio();
      if (shared.errors.length > 0) {
        send({ event: "portfolio_error", error: shared.errors.map((e) => `${e.source}: ${e.message}`).join("; ") });
      }
      // Emit the shared portfolio once; the client stitches it back into each
      // ticker payload before saving. Avoids serializing the same portfolio N
      // times into the SSE stream and N times into sessionStorage.
      send({ event: "portfolio", portfolio: shared.portfolio });

      await runWithConcurrency(tickers, concurrency, async (rawTicker) => {
        try {
          let symbol: string;
          send({ ticker: rawTicker, stage: "prep", status: "loading" });
          try {
            symbol = normalizeSymbol(rawTicker);
          } catch (e) {
            const msg = (e as Error).message;
            send({ ticker: rawTicker, stage: "prep", status: "error", error: msg });
            send({ ticker: rawTicker, stage: "done", status: "error", error: msg });
            return;
          }
          const tk = toTicker(symbol);

          let snapshot: SnapshotResult;
          try {
            snapshot = await getSnapshot(symbol);
          } catch (e) {
            const msg = (e as Error).message;
            send({ ticker: tk, stage: "prep", status: "error", error: msg });
            send({ ticker: tk, stage: "done", status: "error", error: msg });
            return;
          }

          const subset = await prepareTickerSubset(shared, tk);
          send({ ticker: tk, stage: "prep", status: "done" });

          send({ ticker: tk, stage: "panels", status: "loading" });
          const panels: Record<PanelKey, PanelSummary> = {} as Record<PanelKey, PanelSummary>;
          let nextEarningsDate: string | null = null;
          const panelResults = await Promise.allSettled(
            PANEL_KEYS.map(async (name) => ({ name, run: await runPanel(name, tk, symbol) })),
          );
          for (let i = 0; i < panelResults.length; i++) {
            const r = panelResults[i];
            const name = PANEL_KEYS[i];
            if (r.status === "fulfilled") {
              panels[name] = r.value.run.summary;
              if (name === "fundamentals" && r.value.run.nextEarningsDate !== undefined) {
                nextEarningsDate = r.value.run.nextEarningsDate;
              }
            } else {
              panels[name] = panelError(name, (r.reason as Error)?.message ?? "unknown");
            }
          }
          send({ ticker: tk, stage: "panels", status: "done" });

          send({ ticker: tk, stage: "verdict", status: "loading" });
          let verdict: Verdict;
          try {
            const synth = await synthesizeVerdict({
              ticker: tk,
              symbol,
              snapshot,
              portfolio: shared.portfolio,
              heldPositions: subset.heldPositions,
              heldGroups: subset.heldGroups,
              panels,
            });
            verdict = { ...synth, panels };
          } catch (e) {
            const msg = (e as Error).message;
            send({ ticker: tk, stage: "verdict", status: "error", error: msg });
            send({ ticker: tk, stage: "done", status: "error", error: msg });
            return;
          }
          send({
            ticker: tk,
            stage: "verdict",
            status: "done",
            confidence: verdict.confidence,
          });

          const payload: BatchTickerPayload = {
            ticker: tk,
            symbol,
            snapshot,
            // Per-ticker payload deliberately omits the portfolio — the client
            // stitches it from the earlier "portfolio" event. Kept as a field
            // (set null here) so the type stays stable across producer/consumer.
            portfolio: null,
            heldPositions: subset.heldPositions,
            heldGroups: subset.heldGroups,
            panels,
            verdict,
            nextEarningsDate,
          };
          send({ ticker: tk, stage: "done", status: "done", payload });
        } catch (e) {
          // Catch-all: prevents one ticker's unexpected throw from killing the
          // whole concurrency worker. Emit terminal error and continue.
          send({
            ticker: rawTicker,
            stage: "done",
            status: "error",
            error: (e as Error)?.message ?? "unknown error",
          });
        }
      });

      send({ event: "all_done" });
      clearInterval(heartbeat);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
