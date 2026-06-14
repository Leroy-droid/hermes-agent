import { Link } from "react-router-dom";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export interface GatewayLineStatus {
  label: string;
  tone: string;
}

/** Gateway + session summary for the System sidebar block (no separate strip chrome). */
export function SidebarStatusStrip({ className, status }: SidebarStatusStripProps) {
  const { t } = useI18n();

  if (status === null) {
    return (
      <div className={cn("px-5 py-1.5", className)} aria-hidden>
        <div className="h-2 w-[80%] max-w-full animate-pulse rounded-sm bg-midground/10" />
      </div>
    );
  }

  const gw = gatewayLine(status, t);
  const { activeSessionsLabel, gatewayStatusLabel } = t.app;

  return (
    <Link
      to="/sessions"
      title={t.app.statusOverview}
      className={cn(
        "block text-left",
        "px-5 pb-2 pt-0.5",
        "text-text-secondary",
        "transition-colors hover:text-midground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/40",
        "focus-visible:ring-inset",
        className,
      )}
    >
      <div className="flex flex-col gap-1 font-mondwest text-xs leading-snug tracking-[0.08em] max-lg:flex-row max-lg:items-center max-lg:justify-between max-lg:gap-2 max-lg:text-[0.62rem] max-lg:leading-none">
        <p className="min-w-0 break-words max-lg:truncate">
          <span className="text-text-tertiary max-lg:hidden">{gatewayStatusLabel}</span>
          <span className="hidden text-text-tertiary max-lg:inline">Gateway</span>{" "}
          <span className={cn("font-medium", gw.tone)}>{gw.label}</span>
        </p>

        <p className="min-w-0 break-words max-lg:shrink-0 max-lg:truncate">
          <span className="text-text-tertiary max-lg:hidden">{activeSessionsLabel}</span>
          <span className="hidden text-text-tertiary max-lg:inline">Active</span>{" "}
          <span className="tabular-nums text-text-secondary">
            {status.active_sessions}
          </span>
        </p>
      </div>
    </Link>
  );
}

function gatewayLine(
  status: StatusResponse,
  t: ReturnType<typeof useI18n>["t"],
): GatewayLineStatus {
  const g = t.app.gatewayStrip;
  const byState: Record<string, { label: string; tone: string }> = {
    running: { label: g.running, tone: "text-success" },
    starting: { label: g.starting, tone: "text-warning" },
    startup_failed: { label: g.failed, tone: "text-destructive" },
    stopped: { label: g.stopped, tone: "text-muted-foreground" },
  };
  if (status.gateway_state && byState[status.gateway_state]) {
    return byState[status.gateway_state];
  }
  return status.gateway_running
    ? { label: g.running, tone: "text-success" }
    : { label: g.off, tone: "text-muted-foreground" };
}

interface SidebarStatusStripProps {
  className?: string;
  status: StatusResponse | null;
}
