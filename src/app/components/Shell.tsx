export const SHELL = "grid min-h-screen grid-rows-[auto_1fr] bg-surface text-on-surface";
export const MAIN = "scrollbar-slim min-h-0 overflow-y-auto p-6 pb-12";
export const MAIN_INNER = "mx-auto flex max-w-[1320px] flex-col gap-5";
export const PANEL_GRID = "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(420px,1fr))]";

export function HeroEmpty() {
  return (
    <div className="flex flex-col items-start gap-1.5 border-b border-outline-variant py-[18px]">
      <h1 className="font-heading text-[22px] leading-normal font-semibold">Ticker analysis</h1>
      <p className="text-[13px] text-on-surface-variant">
        Search a symbol above to synthesize capital flow, technicals, options activity, news, and community
        sentiment into a single dual-sleeve verdict.
      </p>
    </div>
  );
}
