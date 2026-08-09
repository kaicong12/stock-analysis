"use client";

import { Markdown } from "./Markdown";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  text: string | null;
  status: "idle" | "loading" | "ready" | "error";
}

// `!` on the heading/list rules: they have to outrank `.markdown h1` from
// page.module.css, whose selector carries equal specificity.
const PROSE =
  "text-[12.5px] leading-[1.6] text-on-surface-variant " +
  "[&>*:first-child]:mt-0! " +
  "[&_h1]:font-heading [&_h1]:m-0! [&_h1]:mt-3! [&_h1]:mb-1! [&_h1]:text-xs! [&_h1]:font-semibold! [&_h1]:tracking-[0.04em] [&_h1]:uppercase [&_h1]:text-on-surface! " +
  "[&_h2]:font-heading [&_h2]:m-0! [&_h2]:mt-3! [&_h2]:mb-1! [&_h2]:text-xs! [&_h2]:font-semibold! [&_h2]:tracking-[0.04em] [&_h2]:uppercase [&_h2]:text-on-surface! " +
  "[&_h3]:font-heading [&_h3]:m-0! [&_h3]:mt-3! [&_h3]:mb-1! [&_h3]:text-xs! [&_h3]:font-semibold! [&_h3]:tracking-[0.04em] [&_h3]:uppercase [&_h3]:text-on-surface! " +
  "[&_ul]:pl-4! [&_ul]:mt-0! [&_ul]:mb-2! [&_ol]:pl-4! [&_ol]:mt-0! [&_ol]:mb-2! " +
  "[&_li]:marker:text-primary";

export function MacroBriefing({ text, status }: Props) {
  return (
    <Card className="gap-3.5 border-outline-variant px-6 py-5">
      <div className="flex items-center gap-2.5">
        <span className="font-heading text-[13px] font-semibold tracking-[0.06em] uppercase text-on-surface">
          Macro Environment
        </span>
        <Badge className="rounded-[3px] border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase text-primary">
          Live · Google Search
        </Badge>
      </div>

      {status === "loading" && (
        <div className="flex flex-col gap-2.5 py-1">
          <Skeleton className="h-3 w-[72%]" />
          <Skeleton className="h-3 w-[88%]" />
          <Skeleton className="h-3 w-[60%]" />
          <Skeleton className="h-3 w-[80%]" />
        </div>
      )}

      {status === "error" && (
        <p className="text-xs leading-normal italic text-on-surface-variant">
          Macro briefing unavailable — Google Search grounding failed.
        </p>
      )}

      {status === "ready" && text && <Markdown className={PROSE}>{text}</Markdown>}
    </Card>
  );
}
