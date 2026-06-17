import type { ReactNode } from "react";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export function SidebarFooter({ mobileThemeControl, status }: SidebarFooterProps) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2",
        "px-5 py-2.5 max-lg:px-5 max-lg:py-2",
        "border-t border-current/10",
      )}
    >
      <Typography
        className="justify-self-start font-mono-ui text-xs tabular-nums tracking-[0.08em] text-text-tertiary lowercase"
      >
        {status?.version != null ? `v${status.version}` : "—"}
      </Typography>

      {mobileThemeControl && (
        <div className="hidden justify-self-center max-lg:block">
          {mobileThemeControl}
        </div>
      )}

      <a
        href="https://nousresearch.com"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "justify-self-end",
          "font-mondwest text-display text-xs tracking-[0.12em] text-midground",
          "transition-opacity hover:opacity-90",
          "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/40",
        )}
        style={{ mixBlendMode: "plus-lighter" }}
      >
        {t.app.footer.org}
      </a>
    </div>
  );
}

interface SidebarFooterProps {
  mobileThemeControl?: ReactNode;
  status: StatusResponse | null;
}
