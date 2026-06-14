import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  MessageSquare,
  Search,
  Trash2,
  Clock,
  Terminal,
  Globe,
  MessageCircle,
  Hash,
  X,
  Play,
  Eraser,
  Download,
  Pencil,
  Check,
  Archive,
  Pin,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  SessionInfo,
  SessionMessage,
  SessionSearchResult,
  SessionStoreStats,
  StatusResponse,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { PlatformsCard } from "@/components/PlatformsCard";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { Button } from "@nous-research/ui/ui/components/button";
import { Checkbox } from "@nous-research/ui/ui/components/checkbox";
import { ListItem } from "@nous-research/ui/ui/components/list-item";
import { Segmented } from "@nous-research/ui/ui/components/segmented";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@nous-research/ui/ui/components/card";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useConfirmDelete } from "@nous-research/ui/hooks/use-confirm-delete";
import { Input } from "@nous-research/ui/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nous-research/ui/ui/components/dialog";
import { useSystemActions } from "@/contexts/useSystemActions";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { useBelowBreakpoint } from "@nous-research/ui/hooks/use-below-breakpoint";
import { useI18n } from "@/i18n";
import { usePageHeader } from "@/contexts/usePageHeader";
import { PluginSlot } from "@/plugins";
import { isDashboardEmbeddedChatEnabled } from "@/lib/dashboard-flags";

const SOURCE_CONFIG: Record<string, { icon: typeof Terminal; color: string }> =
  {
    tui: { icon: Terminal, color: "text-emerald-100" },
    cli: { icon: Terminal, color: "text-primary" },
    telegram: { icon: MessageCircle, color: "text-[oklch(0.65_0.15_250)]" },
    discord: { icon: Hash, color: "text-[oklch(0.65_0.15_280)]" },
    slack: { icon: MessageSquare, color: "text-[oklch(0.7_0.15_155)]" },
    whatsapp: { icon: Globe, color: "text-success" },
    cron: { icon: Clock, color: "text-warning" },
  };

const MOBILE_SESSION_TONES: Record<
  string,
  { badge: string; expanded: string; pinned: string; row: string }
> = {
  tui: {
    badge: "border-emerald-200/22 bg-emerald-300/[0.105] text-emerald-50/85",
    expanded: "max-sm:border-emerald-200/14 max-sm:bg-background-base/50",
    pinned:
      "hermes-mobile-session-pinned--teal border-emerald-200/20 bg-emerald-300/16 text-emerald-50 shadow-[0_18px_44px_rgba(45,212,191,0.16)] hover:bg-emerald-300/20",
    row: "hermes-mobile-session-row--teal max-sm:border-emerald-200/18 max-sm:bg-background-base/50",
  },
  cli: {
    badge: "border-emerald-200/22 bg-emerald-300/[0.105] text-emerald-50/85",
    expanded: "max-sm:border-emerald-200/14 max-sm:bg-background-base/50",
    pinned:
      "hermes-mobile-session-pinned--teal border-emerald-200/20 bg-emerald-300/16 text-emerald-50 shadow-[0_18px_44px_rgba(45,212,191,0.16)] hover:bg-emerald-300/20",
    row: "hermes-mobile-session-row--teal max-sm:border-emerald-200/18 max-sm:bg-background-base/50",
  },
  telegram: {
    badge: "border-sky-200/22 bg-sky-300/[0.105] text-sky-50/85",
    expanded: "max-sm:border-sky-200/14 max-sm:bg-background-base/50",
    pinned:
      "hermes-mobile-session-pinned--teal border-emerald-200/20 bg-emerald-300/16 text-emerald-50 shadow-[0_18px_44px_rgba(45,212,191,0.16)] hover:bg-emerald-300/20",
    row: "hermes-mobile-session-row--sky max-sm:border-sky-200/18 max-sm:bg-background-base/50",
  },
  cron: {
    badge: "border-warning/24 bg-warning/[0.105] text-warning/90",
    expanded: "max-sm:border-warning/14 max-sm:bg-background-base/50",
    pinned:
      "hermes-mobile-session-pinned--teal border-emerald-200/20 bg-emerald-300/16 text-emerald-50 shadow-[0_18px_44px_rgba(45,212,191,0.16)] hover:bg-emerald-300/20",
    row: "hermes-mobile-session-row--gold max-sm:border-warning/20 max-sm:bg-background-base/50",
  },
  default: {
    badge: "border-midground/18 bg-midground/[0.075] text-text-secondary",
    expanded: "max-sm:border-midground/12 max-sm:bg-background-base/50",
    pinned:
      "hermes-mobile-session-pinned--teal border-emerald-200/20 bg-emerald-300/16 text-emerald-50 shadow-[0_18px_44px_rgba(45,212,191,0.16)] hover:bg-emerald-300/20",
    row: "hermes-mobile-session-row--neutral max-sm:border-midground/16 max-sm:bg-background-base/50",
  },
};

function mobileSessionTone(session: SessionInfo) {
  return (
    MOBILE_SESSION_TONES[session.source ?? ""] ?? MOBILE_SESSION_TONES.default
  );
}

/** Render an FTS5 snippet with highlighted matches.
 *  The backend wraps matches in >>> and <<< delimiters. */
function SnippetHighlight({ snippet }: { snippet: string }) {
  const parts: React.ReactNode[] = [];
  const regex = />>>(.*?)<<</g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(snippet)) !== null) {
    if (match.index > last) {
      parts.push(snippet.slice(last, match.index));
    }
    parts.push(
      <mark key={i++} className="bg-warning/30 text-warning px-0.5">
        {match[1]}
      </mark>,
    );
    last = regex.lastIndex;
  }
  if (last < snippet.length) {
    parts.push(snippet.slice(last));
  }
  return (
    <p className="font-mondwest normal-case mt-0.5 min-w-0 max-w-full truncate text-xs text-text-secondary">
      {parts}
    </p>
  );
}

function ToolCallBlock({
  toolCall,
}: {
  toolCall: { id: string; function: { name: string; arguments: string } };
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  let args = toolCall.function.arguments;
  try {
    args = JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    // keep as-is
  }

  return (
    <div className="mt-2 border border-warning/20 bg-warning/5">
      <ListItem
        onClick={() => setOpen(!open)}
        aria-label={`${open ? t.common.collapse : t.common.expand} tool call ${toolCall.function.name}`}
        aria-expanded={open}
        className="px-3 py-2 text-xs text-warning hover:bg-warning/10 hover:text-warning"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="font-mono-ui font-medium">
          {toolCall.function.name}
        </span>
        <span className="text-warning/50 ml-auto">{toolCall.id}</span>
      </ListItem>
      {open && (
        <pre className="border-t border-warning/20 px-3 py-2 text-xs text-warning/80 overflow-x-auto whitespace-pre-wrap font-mono">
          {args}
        </pre>
      )}
    </div>
  );
}

// Context-compaction handoff blocks are persisted as ``role="user"`` or
// ``role="assistant"`` with content starting with one of these prefixes —
// they're metadata inserted by ``agent/context_compressor.py``, NOT real
// turns the user typed or the model replied with. Rendering them with
// the same styling as regular messages confuses operators scrolling the
// session timeline (#29824 — "WebUI can show context compaction block
// instead of latest assistant response after compression"), so we
// detect them here and downgrade them to a muted, clearly-labelled
// "Context handoff" row.
//
// Keep these prefixes (and the END marker below) in sync with
// ``SUMMARY_PREFIX`` / ``LEGACY_SUMMARY_PREFIX`` and the
// merge-into-tail marker in ``agent/context_compressor.py``.
const COMPACTION_PREFIXES = [
  "[CONTEXT COMPACTION — REFERENCE ONLY]",
  "[CONTEXT COMPACTION - REFERENCE ONLY]",
  "[CONTEXT SUMMARY]:",
] as const;

// Marker the compressor inserts between a merged summary and the
// original tail message content. When the summary role would collide
// with both head and tail roles (e.g. head ends with ``user`` and tail
// starts with ``assistant``), the compressor merges the summary as a
// prefix on the first tail message instead of inserting a standalone
// row. We split on this marker so the WebUI still shows the original
// assistant reply as its own readable bubble — otherwise the merged
// row reads as a single opaque "Context compaction" block and the
// user can't see the reply (#29824).
const COMPACTION_END_MARKER =
  "--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---";

interface CompactionSplit {
  /** Summary text (header + body, without the end marker). */
  summary: string;
  /** Original message content that came after the end marker. */
  remainder: string;
}

function splitCompactionContent(content: string): CompactionSplit | null {
  const head = content.trimStart();
  if (!COMPACTION_PREFIXES.some((p) => head.startsWith(p))) return null;
  const markerIdx = content.indexOf(COMPACTION_END_MARKER);
  if (markerIdx < 0) {
    return { summary: content, remainder: "" };
  }
  return {
    summary: content.slice(0, markerIdx),
    remainder: content
      .slice(markerIdx + COMPACTION_END_MARKER.length)
      .replace(/^\s+/, ""),
  };
}


function MessageBubble({
  msg,
  highlight,
}: {
  msg: SessionMessage;
  highlight?: string;
}) {
  const { t } = useI18n();

  const ROLE_STYLES: Record<
    string,
    { bg: string; text: string; label: string }
  > = {
    user: {
      bg: "bg-primary/10",
      text: "text-primary",
      label: t.sessions.roles.user,
    },
    assistant: {
      bg: "bg-success/10",
      text: "text-success",
      label: t.sessions.roles.assistant,
    },
    system: {
      bg: "bg-muted",
      text: "text-muted-foreground",
      label: t.sessions.roles.system,
    },
    tool: {
      bg: "bg-warning/10",
      text: "text-warning",
      label: t.sessions.roles.tool,
    },
    // Compaction handoffs render as faded system-style metadata with a
    // distinctive label so they can't be mistaken for real assistant
    // replies during a scroll-back review (#29824).
    compaction: {
      bg: "bg-muted/50",
      text: "text-muted-foreground italic",
      label: "Context handoff",
    },
  };

  // When a compaction handoff is merged into the front of the first
  // tail message (the compressor's double-collision path —
  // ``_merge_summary_into_tail`` in ``agent/context_compressor.py``),
  // the message we received is ``[CONTEXT COMPACTION ...] + END_MARKER
  // + <original assistant reply>``. We split it back into two visual
  // rows here so the operator's actual answer survives as a readable
  // bubble next to the (clearly-labelled) handoff metadata (#29824).
  const compactionSplit =
    typeof msg.content === "string"
      ? splitCompactionContent(msg.content)
      : null;

  if (compactionSplit && compactionSplit.remainder) {
    return (
      <>
        <MessageBubble
          msg={{ ...msg, content: compactionSplit.summary }}
          highlight={highlight}
        />
        <MessageBubble
          msg={{
            ...msg,
            content: compactionSplit.remainder,
            // The remainder is the original assistant reply that the
            // compressor pre-pended the summary to — render with the
            // normal assistant styling, NOT the muted handoff style.
            // ``isCompactionMessage`` returns false on this stripped
            // content because it no longer starts with the prefix.
          }}
          highlight={highlight}
        />
      </>
    );
  }

  const isCompaction = compactionSplit !== null;
  const style = isCompaction
    ? ROLE_STYLES.compaction
    : ROLE_STYLES[msg.role] ?? ROLE_STYLES.system;
  const label = isCompaction
    ? ROLE_STYLES.compaction.label
    : msg.tool_name
      ? `${t.sessions.roles.tool}: ${msg.tool_name}`
      : style.label;

  // Check if any search term appears as a prefix of any word in content
  const isHit = (() => {
    if (!highlight || !msg.content) return false;
    const content = msg.content.toLowerCase();
    const terms = highlight.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.some((term) => content.includes(term));
  })();

  // Split search query into terms for inline highlighting
  const highlightTerms =
    isHit && highlight ? highlight.split(/\s+/).filter(Boolean) : undefined;

  return (
    <div
      className={`${style.bg} p-3 ${isHit ? "ring-1 ring-warning/40" : ""}`}
      data-search-hit={isHit || undefined}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold ${style.text}`}>{label}</span>
        {isHit && (
          <Badge tone="warning" className="text-xs py-0 px-1.5">
            {t.common.match}
          </Badge>
        )}
        {msg.timestamp && (
          <span className="text-xs text-text-tertiary">
            {timeAgo(msg.timestamp)}
          </span>
        )}
      </div>
      {msg.content &&
        (msg.role === "system" ? (
          <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {msg.content}
          </div>
        ) : (
          <Markdown content={msg.content} highlightTerms={highlightTerms} />
        ))}
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <div className="mt-1">
          {msg.tool_calls.map((tc) => (
            <ToolCallBlock key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Message list with auto-scroll to first search hit. */
function MessageList({
  messages,
  highlight,
}: {
  messages: SessionMessage[];
  highlight?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlight || !containerRef.current) return;
    // Scroll to first hit after render
    const timer = setTimeout(() => {
      const hit = containerRef.current?.querySelector("[data-search-hit]");
      if (hit) {
        hit.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, highlight]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 max-h-[600px] overflow-y-auto pr-2"
    >
      {messages.map((msg, i) => (
        <MessageBubble key={i} msg={msg} highlight={highlight} />
      ))}
    </div>
  );
}

function SessionRow({
  session,
  snippet,
  searchQuery,
  isExpanded,
  isSelected,
  onToggle,
  onSelectClick,
  onDelete,
  onRename,
  onExport,
  openInChatOnRow,
  resumeInChatEnabled,
}: SessionRowProps) {
  const [messages, setMessages] = useState<SessionMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? "");
  const [renameSaving, setRenameSaving] = useState(false);
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    if (isExpanded && messages === null && !loading) {
      // Loading expanded history is an effect-driven fetch; keep the local
      // loading flag adjacent to the request it guards.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      api
        .getSessionMessages(session.id)
        .then((resp) => setMessages(resp.messages))
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false));
    }
  }, [isExpanded, session.id, messages, loading]);

  const sourceInfo = (session.source
    ? SOURCE_CONFIG[session.source]
    : null) ?? { icon: Globe, color: "text-muted-foreground" };
  const SourceIcon = sourceInfo.icon;
  const hasTitle = session.title && session.title !== "Untitled";
  const mobileTone = mobileSessionTone(session);
  const openInChat = () => {
    if (!resumeInChatEnabled) return;
    navigate(`/chat?resume=${encodeURIComponent(session.id)}`);
  };

  const submitRename = async () => {
    const value = renameValue.trim();
    if (!value || value === session.title) {
      setRenaming(false);
      return;
    }
    setRenameSaving(true);
    try {
      await onRename(session.id, value);
      setRenaming(false);
    } finally {
      setRenameSaving(false);
    }
  };

  const actionButtons = (
    <>
      <Badge tone="outline" className="text-xs">
        {session.source ?? "local"}
      </Badge>

      {resumeInChatEnabled && (
        <Button
          ghost
          size="icon"
          className="text-muted-foreground hover:text-success"
          aria-label={t.sessions.resumeInChat}
          title={t.sessions.resumeInChat}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/chat?resume=${encodeURIComponent(session.id)}`);
          }}
        >
          <Play />
        </Button>
      )}

      <Button
        ghost
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Rename session"
        title="Rename session"
        onClick={(e) => {
          e.stopPropagation();
          setRenameValue(
            session.title && session.title !== "Untitled"
              ? session.title
              : "",
          );
          setRenaming(true);
        }}
      >
        <Pencil />
      </Button>

      <Button
        ghost
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Export session"
        title="Export session JSON"
        onClick={(e) => {
          e.stopPropagation();
          onExport(session.id);
        }}
      >
        <Download />
      </Button>

      <Button
        ghost
        destructive
        size="icon"
        aria-label={t.sessions.deleteSession}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 />
      </Button>
    </>
  );

  // Selected rows get a stronger left-edge accent + tinted background so the
  // selection state is unambiguous even when scrolling past the bulk-action
  // bar at the top. Beat the is_active styling — explicit user selection
  // takes priority over "this session is live".
  const containerClasses = isSelected
    ? "border-primary/35 bg-primary/[0.05] max-sm:border-primary/28 max-sm:bg-primary/[0.09]"
    : session.is_active
      ? "border-success/28 bg-success/[0.025] max-sm:border-success/24 max-sm:bg-success/[0.06]"
      : `border-border ${mobileTone.row}`;

  // Clicking the checkbox must NOT toggle row expansion; selection and
  // expansion are independent gestures. We bind ``onClick`` directly on
  // the Checkbox (which Radix forwards to its underlying ``<button
  // role=checkbox>``) so the event carries the real ``shiftKey`` state
  // for range-select AND so keyboard activation (Space on the focused
  // checkbox) toggles selection via the same code path — the browser
  // synthesises a click on <button> for Space, so one handler covers
  // mouse + keyboard cleanly.
  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectClick(e);
  };

  return (
    <div
      className={`max-w-full min-w-0 overflow-hidden border transition-colors max-sm:min-h-[4.35rem] max-sm:shrink-0 max-sm:rounded-[0.82rem] max-sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_10px_28px_rgba(0,0,0,0.1)] max-sm:backdrop-blur-md ${containerClasses}`}
    >
      <div
        className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-secondary/30 max-sm:min-h-[4.35rem] max-sm:gap-1 max-sm:p-2"
        onClick={openInChatOnRow && resumeInChatEnabled ? openInChat : onToggle}
      >
        <span className="flex shrink-0 items-center pt-0.5 max-sm:hidden">
          <Checkbox
            checked={isSelected}
            onClick={handleSelectClick}
            aria-label={t.sessions.selectSession}
          />
        </span>
        <div className={`shrink-0 pt-0.5 ${sourceInfo.color}`}>
          <SourceIcon className="h-4 w-4 max-sm:h-3 max-sm:w-3" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 max-sm:gap-1">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                {renaming ? (
                  <div
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitRename();
                        else if (e.key === "Escape") setRenaming(false);
                      }}
                      placeholder="Session title"
                      className="h-7 min-w-0 flex-1 py-0 text-sm"
                      disabled={renameSaving}
                    />
                    <Button
                      ghost
                      size="icon"
                      className="text-muted-foreground hover:text-success"
                      aria-label="Save title"
                      title="Save title"
                      disabled={renameSaving}
                      onClick={() => void submitRename()}
                    >
                      {renameSaving ? (
                        <Spinner className="text-sm" />
                      ) : (
                        <Check />
                      )}
                    </Button>
                    <Button
                      ghost
                      size="icon"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Cancel rename"
                      title="Cancel rename"
                      disabled={renameSaving}
                      onClick={() => setRenaming(false)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <span
                    className={`font-mondwest normal-case min-w-0 flex-1 truncate text-sm max-sm:text-[0.74rem] max-sm:leading-[1.03] ${hasTitle ? "font-medium" : "text-muted-foreground italic"}`}
                  >
                    {hasTitle
                      ? session.title
                      : session.preview
                        ? session.preview.slice(0, 60)
                        : t.sessions.untitledSession}
                  </span>
                )}
                {session.is_active && (
                  <Badge tone="success" className="shrink-0 text-xs">
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    {t.common.live}
                  </Badge>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground max-sm:text-[0.52rem] max-sm:leading-tight">
                <span className="max-w-[min(100%,12rem)] truncate sm:max-w-[180px] max-sm:max-w-[5.25rem]">
                  {(session.model ?? t.common.unknown).split("/").pop()}
                </span>
                <span className="text-border">&#183;</span>
                <span className="shrink-0">
                  {session.message_count} {t.common.msgs}
                </span>
                {session.tool_call_count > 0 && (
                  <>
                    <span className="text-border">&#183;</span>
                    <span className="shrink-0">
                      {session.tool_call_count} {t.common.tools}
                    </span>
                  </>
                )}
                <span className="text-border">&#183;</span>
                <span className="shrink-0">{timeAgo(session.last_active)}</span>
              </div>
              {snippet && <SnippetHighlight snippet={snippet} />}
            </div>

            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {actionButtons}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:hidden">
            {resumeInChatEnabled && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[0.54rem] text-text-secondary">
                Open
                <ChevronRight className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div
          className={`min-w-0 border-t border-border bg-background/50 p-4 ${mobileTone.expanded}`}
        >
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="text-xl text-primary" />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive py-4 text-center">{error}</p>
          )}
          {messages && messages.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t.sessions.noMessages}
            </p>
          )}
          {messages && messages.length > 0 && (
            <MessageList messages={messages} highlight={searchQuery} />
          )}
        </div>
      )}
    </div>
  );
}

type SessionsView = "list" | "overview";
type SessionListRubberbandEdge = "top" | "bottom";

const PAGE_SIZE = 20;
const DESKTOP_PINNED_SESSIONS_KEY = "hermes.desktop.pinnedSessions";
const DESKTOP_PINNED_FETCH_LIMIT = 200;

function newestFirst(a: SessionInfo, b: SessionInfo): number {
  return new Date(b.last_active).getTime() - new Date(a.last_active).getTime();
}

type PinAwareSessionInfo = SessionInfo & { _lineage_root_id?: string | null };

function sessionPinId(session: SessionInfo): string {
  return (session as PinAwareSessionInfo)._lineage_root_id ?? session.id;
}

function readDesktopPinnedSessionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DESKTOP_PINNED_SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}

function uniqueSessions(sessions: SessionInfo[]): SessionInfo[] {
  const seen = new Set<string>();
  const next: SessionInfo[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    next.push(session);
  }
  return next;
}

function resolvePinnedDesktopSessions(
  pinnedIds: string[],
  sessions: SessionInfo[],
): SessionInfo[] {
  const byPinId = new Map<string, SessionInfo>();
  for (const session of sessions) {
    byPinId.set(session.id, session);
    const pinId = sessionPinId(session);
    if (!byPinId.has(pinId)) {
      byPinId.set(pinId, session);
    }
  }
  return pinnedIds
    .map((id) => byPinId.get(id))
    .filter((session): session is SessionInfo => Boolean(session));
}

function mobilePinnedFallbackSessions(sessions: SessionInfo[]): SessionInfo[] {
  const substantial = sessions.filter((session) => {
    const title = session.title?.trim();
    return (
      title &&
      title !== "Untitled" &&
      title.length > 5 &&
      session.message_count > 1
    );
  });
  return (substantial.length >= 2 ? substantial : sessions).slice(0, 2);
}

function SessionsPagination({
  className,
  compact = false,
  onPageChange,
  page,
  total,
}: SessionsPaginationProps) {
  const { t } = useI18n();
  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div
      className={`flex items-center ${compact ? "gap-1" : "justify-between pt-2"}${className ? ` ${className}` : ""}`}
    >
      {!compact && (
        <span className="text-xs text-muted-foreground">
          {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
          {t.common.of} {total}
        </span>
      )}

      <div className="flex items-center gap-1">
        <Button
          outlined
          size="icon"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label={t.sessions.previousPage}
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 text-xs text-muted-foreground">
          {t.common.page} {page + 1} {t.common.of} {pageCount}
        </span>
        <Button
          outlined
          size="icon"
          disabled={(page + 1) * PAGE_SIZE >= total}
          onClick={() => onPageChange(page + 1)}
          aria-label={t.sessions.nextPage}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function SessionsMobileSearch({
  onSearchChange,
  search,
  searching,
}: SessionsMobileSearchProps) {
  const { t } = useI18n();

  return (
    <form
      role="search"
      className="hermes-session-search-glass shrink-0 border-t border-midground/10 bg-background-base/70 p-3 backdrop-blur-xl sm:hidden"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex items-end gap-2 rounded-[1.45rem] border border-midground/15 bg-[color-mix(in_srgb,var(--midground-base)_5%,var(--background-base))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.22)]">
        <Input
          type="search"
          placeholder="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-12 min-w-0 flex-1 border-0 bg-transparent px-2 py-3 text-base leading-6 text-midground shadow-none [background:transparent] placeholder:text-text-secondary/65 focus-visible:ring-0"
        />
        {searching && (
          <Spinner className="mb-4 shrink-0 text-[0.875rem] text-primary" />
        )}
        <Button
          type="button"
          onClick={() => onSearchChange("")}
          disabled={!search}
          aria-label={t.common.clear}
          className="hermes-ios-tap mb-0.5 flex h-12 min-h-12 w-12 min-w-12 shrink-0 items-center justify-center rounded-full border border-midground/20 bg-midground/10 p-0 text-center text-midground shadow-[0_0_24px_rgba(45,212,191,0.16)] disabled:opacity-35 disabled:shadow-none"
        >
          <span className="grid h-full w-full place-items-center">
            <X className="h-5 w-5" />
          </span>
        </Button>
      </div>
    </form>
  );
}

function MobilePinnedSessionCard({
  onOpen,
  resumeInChatEnabled,
  session,
}: MobilePinnedSessionCardProps) {
  const sourceInfo = (session.source
    ? SOURCE_CONFIG[session.source]
    : null) ?? { icon: Globe, color: "text-muted-foreground" };
  const SourceIcon = sourceInfo.icon;
  const hasTitle = session.title && session.title !== "Untitled";
  const mobileTone = mobileSessionTone(session);

  return (
    <button
      type="button"
      className={`group flex min-h-[4.35rem] min-w-0 flex-col rounded-[0.82rem] border px-2 py-1.5 text-left backdrop-blur-md transition-colors ${mobileTone.pinned}`}
      disabled={!resumeInChatEnabled}
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-start gap-1 text-midground">
        <Pin className="mt-0.5 h-3 w-3 shrink-0 fill-current" />
        <SourceIcon className={`mt-0.5 h-3 w-3 shrink-0 ${sourceInfo.color}`} />
        <span className="font-mondwest normal-case min-w-0 flex-1 text-[0.74rem] font-medium leading-[1.03] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
          {hasTitle
            ? session.title
            : session.preview
              ? session.preview.slice(0, 48)
              : "Untitled session"}
        </span>
      </div>

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-mono-ui text-[0.52rem] leading-tight text-text-secondary">
        <span className="truncate">
          {(session.model ?? "unknown").split("/").pop()}
        </span>
        <span className="text-midground/38">•</span>
        <span>{session.message_count} msgs</span>
        {session.tool_call_count > 0 && (
          <>
            <span className="text-midground/38">•</span>
            <span>{session.tool_call_count} tools</span>
          </>
        )}
      </div>

      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-mono-ui text-[0.52rem] leading-tight text-text-secondary">
        <span>{timeAgo(session.last_active)}</span>
        <span className="text-midground/38">•</span>
        <span className="truncate">Pinned</span>
      </div>

      <div className="mt-auto flex items-end justify-end gap-2 pt-0.5">
        <span className="inline-flex items-center gap-0.5 font-mono-ui text-[0.54rem] text-midground">
          Open
          <ChevronRight className="h-2.5 w-2.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    SessionSearchResult[] | null
  >(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const logScrollRef = useRef<HTMLPreElement | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [overviewSessions, setOverviewSessions] = useState<SessionInfo[]>([]);
  const [desktopPinnedSessionIds, setDesktopPinnedSessionIds] = useState<string[]>(
    () => readDesktopPinnedSessionIds(),
  );
  const [sessionListScrolled, setSessionListScrolled] = useState(false);
  const [sessionListRubberband, setSessionListRubberband] =
    useState<SessionListRubberbandEdge | null>(null);
  const [view, setView] = useState<SessionsView>("overview");
  // Count of empty (no-message, ended, non-archived) sessions across the
  // entire DB, populated by /api/sessions/empty/count. Used to:
  //   • hide the "Delete empty" button when there's nothing to clean up
  //   • show "(N)" alongside the label
  //   • surface the count in the confirm dialog body
  // Refreshed on mount, after single-session deletes, and after the bulk
  // delete itself — none of those code paths can update the global empty
  // count from local state alone (per-page list != global DB count).
  const [emptyCount, setEmptyCount] = useState(0);
  const [deleteEmptyOpen, setDeleteEmptyOpen] = useState(false);
  const [deletingEmpty, setDeletingEmpty] = useState(false);
  // Bulk-select-then-delete state. ``selectedIds`` is a Set so per-row
  // checkbox toggles and ``has()`` lookups are O(1); we wrap mutations
  // in a fresh Set so React notices the change (mutating in place
  // wouldn't trigger a re-render).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Index of the last row whose checkbox was clicked WITHOUT shift,
  // resolved against the currently visible (post-search) ``filtered``
  // list. Used as the anchor for shift-click range select — matches the
  // Gmail / Notion / file-explorer convention. ``null`` means "no
  // anchor yet", in which case shift-click degrades to a plain toggle.
  const lastClickedIndexRef = useRef<number | null>(null);
  const sessionListRubberbandTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionListTouchYRef = useRef<number | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [stats, setStats] = useState<SessionStoreStats | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneDays, setPruneDays] = useState("90");
  const [pruning, setPruning] = useState(false);
  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const { setAfterTitle, setEnd } = usePageHeader();
  const { activeAction, actionStatus, dismissLog } = useSystemActions();
  const navigate = useNavigate();
  const resumeInChatEnabled = isDashboardEmbeddedChatEnabled();
  const isMobile = useBelowBreakpoint(640);

  const triggerSessionListRubberband = useCallback(
    (edge: SessionListRubberbandEdge) => {
      if (!isMobile) return;
      if (sessionListRubberbandTimerRef.current) {
        clearTimeout(sessionListRubberbandTimerRef.current);
      }
      setSessionListRubberband(null);
      window.requestAnimationFrame(() => setSessionListRubberband(edge));
      sessionListRubberbandTimerRef.current = setTimeout(() => {
        setSessionListRubberband(null);
        sessionListRubberbandTimerRef.current = null;
      }, 480);
    },
    [isMobile],
  );

  const maybeRubberbandSessionList = useCallback(
    (el: HTMLDivElement, deltaY: number) => {
      const maxScrollTop = el.scrollHeight - el.clientHeight;
      if (maxScrollTop <= 1) return;
      if (el.scrollTop <= 1 && deltaY < 0) {
        triggerSessionListRubberband("top");
      } else if (el.scrollTop >= maxScrollTop - 1 && deltaY > 0) {
        triggerSessionListRubberband("bottom");
      }
    },
    [triggerSessionListRubberband],
  );

  const refreshEmptyCount = useCallback(() => {
    api
      .getEmptySessionsCount()
      .then((r) => setEmptyCount(r.count))
      .catch(() => {});
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIndexRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (loading) {
      setAfterTitle(null);
      return;
    }
    setAfterTitle(
      <Badge tone="secondary" className="text-xs tabular-nums">
        {total}
      </Badge>,
    );
    return () => {
      setAfterTitle(null);
    };
  }, [loading, setAfterTitle, total]);

  useEffect(() => {
    setEnd(
      <Button
        outlined
        size="sm"
        className="gap-1.5"
        onClick={() => setPruneOpen(true)}
      >
        <Archive className="h-3.5 w-3.5" />
        Prune old sessions
      </Button>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd]);

  const loadSessions = useCallback((p: number) => {
    const limit = isMobile ? DESKTOP_PINNED_FETCH_LIMIT : PAGE_SIZE;
    const offset = isMobile ? 0 : p * PAGE_SIZE;
    setLoading(true);
    api
      .getSessions(limit, offset)
      .then((resp) => {
        setSessions(resp.sessions.slice().sort(newestFirst));
        setTotal(resp.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isMobile]);

  const loadStats = useCallback(() => {
    api
      .getSessionStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    // Initial/page-driven fetch synchronizes this route with the sessions API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions(page);
    refreshEmptyCount();
  }, [loadSessions, page, refreshEmptyCount]);

  useEffect(() => {
    const loadOverview = () => {
      api
        .getStatus()
        .then(setStatus)
        .catch(() => {});
      api
        .getSessions(DESKTOP_PINNED_FETCH_LIMIT)
        .then((r) => setOverviewSessions(r.sessions.slice().sort(newestFirst)))
        .catch(() => {});
    };
    loadOverview();
    const id = setInterval(loadOverview, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const refreshPinned = () =>
      setDesktopPinnedSessionIds(readDesktopPinnedSessionIds());
    window.addEventListener("storage", refreshPinned);
    window.addEventListener("focus", refreshPinned);
    return () => {
      window.removeEventListener("storage", refreshPinned);
      window.removeEventListener("focus", refreshPinned);
    };
  }, []);

  useEffect(() => {
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [actionStatus?.lines]);

  useEffect(() => {
    return () => {
      if (sessionListRubberbandTimerRef.current) {
        clearTimeout(sessionListRubberbandTimerRef.current);
      }
    };
  }, []);

  // Wrapped setters that ALSO clear the bulk selection. The user's
  // mental model is "I'm selecting what I can see" — carrying a
  // selection across a page change, search input, or view switch
  // would arm invisible rows for deletion, which is the exact footgun
  // the confirm dialog can't catch. Doing this at the call sites
  // instead of in a ``useEffect`` keeps us out of the
  // react-hooks/set-state-in-effect lint trap and the cascading
  // re-render it warns about.
  const goToPage = useCallback(
    (p: number) => {
      setPage(p);
      clearSelection();
    },
    [clearSelection],
  );
  const updateSearch = useCallback(
    (value: string) => {
      setSearch(value);
      clearSelection();
    },
    [clearSelection],
  );
  const switchView = useCallback(
    (next: SessionsView) => {
      setView(next);
      clearSelection();
    },
    [clearSelection],
  );

  // Debounced FTS search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!search.trim()) {
      // Empty search resets derived search state immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults(null);
      setSearching(false);
      return;
    }

    // Search input starts a debounced async fetch from this effect.
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      api
        .searchSessions(search.trim())
        .then((resp) => setSearchResults(resp.results))
        .catch(() => setSearchResults(null))
        .finally(() => setSearching(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const sessionDelete = useConfirmDelete({
    onDelete: useCallback(
      async (id: string) => {
        try {
          await api.deleteSession(id);
          setSessions((prev) => prev.filter((s) => s.id !== id));
          setTotal((prev) => prev - 1);
          if (expandedId === id) setExpandedId(null);
          // Drop the deleted ID from any active bulk-select set — it
          // can't bulk-delete a row that's already gone.
          setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          // A single-session delete might have been an empty one — re-fetch
          // the global empty count so the button hides itself / its badge
          // ticks down without waiting for the next page navigation.
          refreshEmptyCount();
          showToast(t.sessions.sessionDeleted, "success");
          loadStats();
        } catch {
          showToast(t.sessions.failedToDelete, "error");
          throw new Error("delete failed");
        }
      },
      [
        expandedId,
        refreshEmptyCount,
        showToast,
        loadStats,
        t.sessions.sessionDeleted,
        t.sessions.failedToDelete,
      ],
    ),
  });

  /** Toggle one row's selection. When ``event.shiftKey`` is true AND we
   *  have a previous anchor, every row between the anchor and the
   *  current index (inclusive) is set to the current row's NEW state —
   *  matches Gmail/Notion/file-explorer semantics. ``visibleList`` must
   *  be the currently rendered list (post-search), since indices are
   *  resolved against what the user is actually looking at.
   */
  const handleSelectClick = useCallback(
    (event: React.MouseEvent, index: number, visibleList: SessionInfo[]) => {
      const id = visibleList[index]?.id;
      if (!id) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const wasSelected = next.has(id);
        const willSelect = !wasSelected;

        const anchor = lastClickedIndexRef.current;
        // Shift-click extends the selection from the anchor to here.
        // Skip if there's no anchor or the anchor is outside the
        // visible list — in those cases fall through to a plain toggle
        // (the click also resets the anchor below).
        if (event.shiftKey && anchor !== null && anchor < visibleList.length) {
          const [lo, hi] =
            anchor <= index ? [anchor, index] : [index, anchor];
          for (let i = lo; i <= hi; i++) {
            const rowId = visibleList[i]?.id;
            if (!rowId) continue;
            if (willSelect) next.add(rowId);
            else next.delete(rowId);
          }
        } else if (willSelect) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
      // Always update the anchor to the most recent click — even when
      // it was a shift-click that extended a range, the user's next
      // shift-click should anchor from here, not from two steps back.
      lastClickedIndexRef.current = index;
    },
    [],
  );

  const selectAllOnPage = useCallback((visibleList: SessionInfo[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const s of visibleList) next.add(s.id);
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setDeleteSelectedOpen(false);
      return;
    }
    setDeletingSelected(true);
    try {
      const resp = await api.bulkDeleteSessions(ids);
      showToast(
        t.sessions.selectedSessionsDeleted.replace(
          "{count}",
          String(resp.deleted),
        ),
        "success",
      );
      setDeleteSelectedOpen(false);
      // Drop deleted rows out of the visible list immediately rather
      // than waiting for the reload. The reload still runs so total /
      // pagination stays correct, and so any rows the reload pulls in
      // from later pages render in place.
      const deletedSet = new Set(ids);
      setSessions((prev) => prev.filter((s) => !deletedSet.has(s.id)));
      setTotal((prev) => Math.max(0, prev - resp.deleted));
      if (expandedId && deletedSet.has(expandedId)) setExpandedId(null);
      clearSelection();
      loadSessions(page);
      refreshEmptyCount();
    } catch {
      showToast(t.sessions.failedToDeleteSelected, "error");
    } finally {
      setDeletingSelected(false);
    }
  }, [
    clearSelection,
    expandedId,
    loadSessions,
    page,
    refreshEmptyCount,
    selectedIds,
    showToast,
    t.sessions.failedToDeleteSelected,
    t.sessions.selectedSessionsDeleted,
  ]);

  const handleDeleteEmpty = useCallback(async () => {
    setDeletingEmpty(true);
    try {
      const resp = await api.deleteEmptySessions();
      // Show count in the toast so users get confirmation of the actual
      // number removed (which may differ slightly from `emptyCount` if a
      // session entered/left the "empty" set between the count fetch and
      // the delete — e.g. an active session just ended without sending
      // any messages).
      showToast(
        t.sessions.emptySessionsDeleted.replace(
          "{count}",
          String(resp.deleted),
        ),
        "success",
      );
      setDeleteEmptyOpen(false);
      // Reload the current page so any newly-vanished empty sessions
      // drop out of the visible list, and re-fetch the empty count so
      // the button hides itself.
      loadSessions(page);
      refreshEmptyCount();
    } catch {
      showToast(t.sessions.failedToDeleteEmpty, "error");
    } finally {
      setDeletingEmpty(false);
    }
  }, [
    loadSessions,
    page,
    refreshEmptyCount,
    showToast,
    t.sessions.emptySessionsDeleted,
    t.sessions.failedToDeleteEmpty,
  ]);

  const handleRename = useCallback(
    async (id: string, title: string) => {
      try {
        await api.renameSession(id, title);
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title } : s)),
        );
        setOverviewSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title } : s)),
        );
        showToast("Session renamed", "success");
        loadStats();
      } catch {
        showToast("Failed to rename session", "error");
      }
    },
    [showToast, loadStats],
  );

  const handleExport = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(api.exportSessionUrl(id), {
          credentials: "include",
          headers: {
            "X-Hermes-Session-Token":
              (window as unknown as { __HERMES_SESSION_TOKEN__?: string })
                .__HERMES_SESSION_TOKEN__ ?? "",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        showToast("Failed to export session", "error");
      }
    },
    [showToast],
  );

  const handlePrune = useCallback(async () => {
    const days = parseInt(pruneDays, 10);
    if (!Number.isFinite(days) || days < 0) {
      showToast("Enter a valid number of days", "error");
      return;
    }
    setPruning(true);
    try {
      const resp = await api.pruneSessions(days);
      showToast(
        `Pruned ${resp.removed} session${resp.removed === 1 ? "" : "s"}`,
        "success",
      );
      setPruneOpen(false);
      loadSessions(0);
      setPage(0);
      loadStats();
    } catch {
      showToast("Failed to prune sessions", "error");
    } finally {
      setPruning(false);
    }
  }, [pruneDays, showToast, loadSessions, loadStats]);

  const pendingSession = sessionDelete.pendingId
    ? sessions.find((s) => s.id === sessionDelete.pendingId)
    : null;

  // Build snippet map from search results (session_id → snippet)
  const snippetMap = new Map<string, string>();
  if (searchResults) {
    for (const r of searchResults) {
      snippetMap.set(r.session_id, r.snippet);
    }
  }

  // When searching, filter sessions to those with FTS matches;
  // when not searching, show all sessions
  const filtered = (
    searchResults
      ? sessions.filter((s) => snippetMap.has(s.id))
      : sessions
  ).slice().sort(newestFirst);
  const sessionPool = useMemo(
    () => uniqueSessions([...overviewSessions, ...sessions]),
    [overviewSessions, sessions],
  );
  const pinnedDesktopSessions = useMemo(
    () => resolvePinnedDesktopSessions(desktopPinnedSessionIds, sessionPool),
    [desktopPinnedSessionIds, sessionPool],
  );

  const platformEntries = status
    ? Object.entries(status.gateway_platforms ?? {})
    : [];
  const recentSessions = overviewSessions
    .filter((s) => !s.is_active)
    .slice()
    .sort(newestFirst)
    .slice(0, 5);

  const isSearching = Boolean(search.trim());
  const showOverviewTab =
    platformEntries.length > 0 || recentSessions.length > 0;
  const showList = isMobile || view === "list" || isSearching || !showOverviewTab;
  const showPagination =
    !isMobile && showList && !searchResults && total > PAGE_SIZE;
  const mobilePinnedSessions = useMemo(
    () =>
      isMobile && !isSearching
        ? (pinnedDesktopSessions.length > 0
          ? pinnedDesktopSessions
          : mobilePinnedFallbackSessions(filtered))
        : [],
    [filtered, isMobile, isSearching, pinnedDesktopSessions],
  );
  const showMobilePinnedSessions = mobilePinnedSessions.length > 0;
  const mobilePinnedKeys = useMemo(
    () =>
      new Set(
        mobilePinnedSessions.flatMap((session) => [
          session.id,
          sessionPinId(session),
        ]),
      ),
    [mobilePinnedSessions],
  );
  const visibleSessions = showMobilePinnedSessions
    ? filtered.filter(
        (session) =>
          !mobilePinnedKeys.has(session.id) &&
          !mobilePinnedKeys.has(sessionPinId(session)),
      )
    : filtered;

  useEffect(() => {
    // Searching forces the mobile sessions surface back to list mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSearching) setView("list");
  }, [isSearching]);

  useEffect(() => {
    // Search/list changes reset only the visual scroll affordance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionListScrolled(false);
  }, [search, visibleSessions.length]);

  const alerts: { message: string; detail?: string }[] = [];
  if (status) {
    if (status.gateway_state === "startup_failed") {
      alerts.push({
        message: t.status.gatewayFailedToStart,
        detail: status.gateway_exit_reason ?? undefined,
      });
    }
    const failedPlatformEntries = platformEntries.filter(
      ([, info]) => info.state === "fatal" || info.state === "disconnected",
    );
    for (const [name, info] of failedPlatformEntries) {
      const stateLabel =
        info.state === "fatal"
          ? t.status.platformError
          : t.status.platformDisconnected;
      alerts.push({
        message: `${name.charAt(0).toUpperCase() + name.slice(1)} ${stateLabel}`,
        detail: info.error_message ?? undefined,
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="text-2xl text-primary" />
      </div>
    );
  }

  return (
    <div className="hermes-mobile-card hermes-ios-surface hermes-mythic-frame hermes-mobile-sessions-shell relative isolate flex min-h-0 w-full max-w-full flex-col overflow-hidden rounded-[1.65rem] sm:gap-4 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-0 sm:[background:transparent] sm:[backdrop-filter:none]">
      <span aria-hidden="true" className="hermes-mythic-art hermes-mythic-art--sessions" />
      <PluginSlot name="sessions:top" />
      <Toast toast={toast} />

      <DeleteConfirmDialog
        open={sessionDelete.isOpen}
        onCancel={sessionDelete.cancel}
        onConfirm={sessionDelete.confirm}
        title={t.sessions.confirmDeleteTitle}
        description={
          pendingSession?.title && pendingSession.title !== "Untitled"
            ? `"${pendingSession.title}" — ${t.sessions.confirmDeleteMessage}`
            : t.sessions.confirmDeleteMessage
        }
        loading={sessionDelete.isDeleting}
      />

      <DeleteConfirmDialog
        open={deleteEmptyOpen}
        onCancel={() => setDeleteEmptyOpen(false)}
        onConfirm={handleDeleteEmpty}
        title={t.sessions.deleteEmptyConfirmTitle}
        description={t.sessions.deleteEmptyConfirmMessage.replace(
          "{count}",
          String(emptyCount),
        )}
        loading={deletingEmpty}
      />

      <DeleteConfirmDialog
        open={deleteSelectedOpen}
        onCancel={() => setDeleteSelectedOpen(false)}
        onConfirm={handleDeleteSelected}
        title={t.sessions.deleteSelectedConfirmTitle.replace(
          "{count}",
          String(selectedIds.size),
        )}
        description={t.sessions.deleteSelectedConfirmMessage.replace(
          "{count}",
          String(selectedIds.size),
        )}
        loading={deletingSelected}
      />

      <Dialog
        open={pruneOpen}
        onOpenChange={(open) => {
          if (!pruning) setPruneOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Prune old sessions</DialogTitle>
            <DialogDescription>
              Permanently remove archived sessions whose last activity is older
              than the given number of days. Active sessions are never pruned.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="prune-days"
              className="text-xs font-medium text-muted-foreground"
            >
              Older than (days)
            </label>
            <Input
              id="prune-days"
              type="number"
              min={0}
              value={pruneDays}
              onChange={(e) => setPruneDays(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handlePrune();
              }}
              disabled={pruning}
            />
          </div>
          <DialogFooter>
            <Button
              outlined
              onClick={() => setPruneOpen(false)}
              disabled={pruning}
            >
              {t.common.cancel}
            </Button>
            <Button
              destructive
              onClick={() => void handlePrune()}
              disabled={pruning}
              className="gap-1.5"
            >
              {pruning && <Spinner className="text-sm" />}
              Prune
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-current/20 px-4 sm:hidden">
        <div
          className="font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground uppercase"
          style={{ mixBlendMode: "plus-lighter" }}
        >
          Sessions
        </div>
      </div>

      <div
        className="hermes-mobile-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 pt-1 max-sm:overflow-hidden sm:contents sm:overflow-visible sm:p-0"
        data-history-scrolled={sessionListScrolled ? "true" : "false"}
      >

      {showMobilePinnedSessions && (
        <section className="hermes-session-pinned-glass px-0 sm:hidden">
          <div className="grid min-w-0 grid-cols-2 gap-1.5">
            {mobilePinnedSessions.map((s) => (
              <MobilePinnedSessionCard
                key={`pinned-${s.id}`}
                session={s}
                onOpen={() =>
                  navigate(`/chat?resume=${encodeURIComponent(s.id)}`)
                }
                resumeInChatEnabled={resumeInChatEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {stats && (
        <div className="hidden min-w-0 items-center gap-2 rounded-[1.05rem] border border-midground/8 bg-midground/[0.035] px-3 py-2 font-mono-ui text-[0.64rem] uppercase tracking-[0.06em] text-text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-2 sm:rounded-none sm:border sm:border-border sm:bg-background-base/40 sm:px-4 sm:py-3 sm:text-xs sm:normal-case sm:tracking-normal">
          <span className="min-w-0 truncate sm:hidden">
            {stats.total} total
          </span>
          <span className="text-midground/35 sm:hidden">/</span>
          <span className="min-w-0 truncate text-success sm:hidden">
            {stats.active_store} active
          </span>
          <span className="text-midground/35 sm:hidden">/</span>
          <span className="min-w-0 truncate sm:hidden">
            {stats.archived} archived
          </span>
          <span className="ml-auto shrink-0 text-midground sm:hidden">
            {stats.messages} msgs
          </span>

          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="text-lg font-semibold tabular-nums leading-none">
              {stats.total}
            </span>
            <span className="truncate text-[0.65rem] text-muted-foreground sm:text-xs">Total</span>
          </div>
          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="text-lg font-semibold tabular-nums leading-none text-success">
              {stats.active_store}
            </span>
            <span className="truncate text-[0.65rem] text-muted-foreground sm:text-xs">Active</span>
          </div>
          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="text-lg font-semibold tabular-nums leading-none">
              {stats.archived}
            </span>
            <span className="truncate text-[0.65rem] text-muted-foreground sm:text-xs">Archived</span>
          </div>
          <div className="hidden min-w-0 flex-col sm:flex">
            <span className="text-lg font-semibold tabular-nums leading-none">
              {stats.messages}
            </span>
            <span className="truncate text-[0.65rem] text-muted-foreground sm:text-xs">Messages</span>
          </div>
          {Object.keys(stats.by_source).length > 0 && (
            <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex">
              {Object.entries(stats.by_source).map(([src, count]) => (
                <Badge key={src} tone="outline" className="text-xs">
                  {src}: {count}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="border border-destructive/30 bg-destructive/[0.06] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 min-w-0">
              {alerts.map((alert, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-destructive">
                    {alert.message}
                  </p>
                  {alert.detail && (
                    <p className="text-xs text-destructive/70 mt-0.5">
                      {alert.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeAction && (
        <div className="border border-border bg-background-base/50">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {actionStatus?.running ? (
                <Spinner className="shrink-0 text-[0.875rem] text-warning" />
              ) : actionStatus?.exit_code === 0 ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : actionStatus !== null ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <Spinner className="shrink-0 text-[0.875rem] text-muted-foreground" />
              )}

              <span className="text-xs font-mondwest tracking-[0.12em] truncate">
                {activeAction === "restart"
                  ? t.status.restartGateway
                  : t.status.updateHermes}
              </span>

              <Badge
                tone={
                  actionStatus?.running
                    ? "warning"
                    : actionStatus?.exit_code === 0
                      ? "success"
                      : actionStatus
                        ? "destructive"
                        : "outline"
                }
                className="text-xs shrink-0"
              >
                {actionStatus?.running
                  ? t.status.running
                  : actionStatus?.exit_code === 0
                    ? t.status.actionFinished
                    : actionStatus
                      ? `${t.status.actionFailed} (${actionStatus.exit_code ?? "?"})`
                      : t.common.loading}
              </Badge>
            </div>

            <Button
              ghost
              size="icon"
              onClick={dismissLog}
              className="shrink-0 text-text-secondary hover:text-foreground"
              aria-label={t.common.close}
            >
              <X />
            </Button>
          </div>

          <pre
            ref={logScrollRef}
            className="max-h-72 overflow-auto px-3 py-2 font-mono-ui text-xs leading-relaxed whitespace-pre-wrap break-all"
          >
            {actionStatus?.lines && actionStatus.lines.length > 0
              ? actionStatus.lines.join("\n")
              : t.status.waitingForOutput}
          </pre>
        </div>
      )}

      {(showOverviewTab && !isSearching) || showList ? (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
            {showOverviewTab && !isSearching && !isMobile && (
              <Segmented
                className="w-fit shrink-0"
                size="md"
                value={view}
                onChange={switchView}
                options={[
                  { value: "overview", label: t.sessions.overview },
                  { value: "list", label: t.sessions.history },
                ]}
              />
            )}

            {showList && (
              <div className="relative hidden min-w-0 w-full sm:block sm:w-auto sm:min-w-[12rem] sm:max-w-md sm:flex-1">
                {searching ? (
                  <Spinner className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[0.875rem] text-primary" />
                ) : (
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Input
                  placeholder={t.sessions.searchPlaceholder}
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                  className="h-10 rounded-none border-x-0 border-t-0 border-midground/10 bg-transparent py-0 pr-7 pl-8 text-sm leading-none shadow-none [background:transparent] focus-visible:ring-0 sm:h-8 sm:rounded-sm sm:border sm:bg-background sm:text-xs"
                />
                {search && (
                  <Button
                    ghost
                    size="xs"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => updateSearch("")}
                    aria-label={t.common.clear}
                  >
                    <X />
                  </Button>
                )}
              </div>
            )}

            {showList && emptyCount > 0 && !isSearching && (
              <Button
                outlined
                destructive
                size="sm"
                className="shrink-0"
                onClick={() => setDeleteEmptyOpen(true)}
                aria-label={t.sessions.deleteEmpty}
                title={t.sessions.deleteEmpty}
              >
                <Eraser className="h-3.5 w-3.5" />
                <span className="font-mondwest normal-case text-xs">
                  {t.sessions.deleteEmpty} ({emptyCount})
                </span>
              </Button>
            )}
          </div>

          {showPagination && (
            <SessionsPagination
              compact
              className="hidden shrink-0 sm:ml-auto sm:flex"
              page={page}
              total={total}
              onPageChange={goToPage}
            />
          )}
        </div>
      ) : null}

      {showList && selectedIds.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 border border-primary/30 bg-primary/[0.06] px-3 py-2"
          role="region"
          aria-label={t.sessions.selectedCount.replace(
            "{count}",
            String(selectedIds.size),
          )}
        >
          <span className="font-mondwest normal-case text-xs text-primary tabular-nums">
            {t.sessions.selectedCount.replace(
              "{count}",
              String(selectedIds.size),
            )}
          </span>
          {visibleSessions.some((s) => !selectedIds.has(s.id)) && (
            <Button
              ghost
              size="sm"
              onClick={() => selectAllOnPage(visibleSessions)}
              aria-label={t.sessions.selectAllOnPage}
              title={t.sessions.selectAllOnPage}
            >
              <span className="font-mondwest normal-case text-xs">
                {t.sessions.selectAllOnPage}
              </span>
            </Button>
          )}
          <Button
            ghost
            size="sm"
            onClick={clearSelection}
            aria-label={t.sessions.clearSelection}
            title={t.sessions.clearSelection}
          >
            <span className="font-mondwest normal-case text-xs">
              {t.sessions.clearSelection}
            </span>
          </Button>
          <Button
            outlined
            destructive
            size="sm"
            className="ml-auto"
            onClick={() => setDeleteSelectedOpen(true)}
            aria-label={t.sessions.deleteSelected.replace(
              "{count}",
              String(selectedIds.size),
            )}
            title={t.sessions.deleteSelected.replace(
              "{count}",
              String(selectedIds.size),
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="font-mondwest normal-case text-xs">
              {t.sessions.deleteSelected.replace(
                "{count}",
                String(selectedIds.size),
              )}
            </span>
          </Button>
        </div>
      )}

      {showList ? (
        filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Clock className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">
              {search ? t.sessions.noMatch : t.sessions.noSessions}
            </p>
            {!search && (
              <p className="text-xs mt-1 text-text-tertiary">
                {t.sessions.startConversation}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="hidden items-center justify-between border-t border-midground/12 px-0.5 pt-3 font-mono-ui text-[0.76rem] uppercase tracking-[0.18em] text-midground sm:flex">
              <span className="inline-flex min-w-0 items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" />
                <span>History</span>
              </span>
              <span className="tabular-nums">{visibleSessions.length}</span>
            </div>
            <div
              className="hermes-ios-session-list grid min-w-0 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:flex sm:flex-col sm:gap-1.5 sm:overflow-visible sm:rounded-none sm:border-0 sm:pr-0"
              aria-label="Session history"
              data-scrolled={sessionListScrolled ? "true" : "false"}
              data-rubberband={sessionListRubberband ?? undefined}
              role="region"
              tabIndex={0}
              onScroll={(event) => {
                const scrolled = event.currentTarget.scrollTop > 2;
                setSessionListScrolled((current) =>
                  current === scrolled ? current : scrolled,
                );
              }}
              onTouchStart={(event) => {
                sessionListTouchYRef.current = event.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(event) => {
                setSessionListScrolled(true);
                const y = event.touches[0]?.clientY;
                if (y == null || sessionListTouchYRef.current == null) return;
                maybeRubberbandSessionList(
                  event.currentTarget,
                  sessionListTouchYRef.current - y,
                );
              }}
              onTouchEnd={() => {
                sessionListTouchYRef.current = null;
              }}
              onWheel={(event) => {
                setSessionListScrolled(true);
                maybeRubberbandSessionList(
                  event.currentTarget,
                  event.deltaY,
                );
              }}
            >
              {visibleSessions.map((s, index) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  snippet={snippetMap.get(s.id)}
                  searchQuery={search || undefined}
                  isExpanded={expandedId === s.id}
                  isSelected={selectedIds.has(s.id)}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === s.id ? null : s.id))
                  }
                  onSelectClick={(event) =>
                    handleSelectClick(event, index, visibleSessions)
                  }
                  onDelete={() => sessionDelete.requestDelete(s.id)}
                  onRename={handleRename}
                  onExport={handleExport}
                  openInChatOnRow={isMobile}
                  resumeInChatEnabled={resumeInChatEnabled}
                />
              ))}
            </div>

            {showPagination && (
              <SessionsPagination
                className="hidden sm:flex"
                page={page}
                total={total}
                onPageChange={goToPage}
              />
            )}
          </>
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {platformEntries.length > 0 && status && (
            <PlatformsCard platforms={platformEntries} />
          )}

          {recentSessions.length > 0 && (
            <Card className="min-w-0 max-w-full overflow-hidden">
              <CardHeader className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <CardTitle className="min-w-0 truncate text-base">
                    {t.status.recentSessions}
                  </CardTitle>
                </div>
              </CardHeader>

              <CardContent className="grid min-w-0 gap-3">
                {recentSessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex min-w-0 max-w-full flex-col gap-2 border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-mondwest normal-case min-w-0 truncate text-sm font-medium">
                        {s.title ?? t.common.untitled}
                      </span>

                      <span className="min-w-0 break-words text-xs text-muted-foreground">
                        <span className="font-mono-ui">
                          {(s.model ?? t.common.unknown).split("/").pop()}
                        </span>{" "}
                        · {s.message_count} {t.common.msgs} ·{" "}
                        {timeAgo(s.last_active)}
                      </span>

                      {s.preview && (
                        <p className="font-mondwest normal-case min-w-0 max-w-full text-xs leading-snug text-text-tertiary [overflow-wrap:anywhere]">
                          {s.preview}
                        </p>
                      )}
                    </div>

                    <Badge
                      tone="outline"
                      className="shrink-0 self-start text-xs sm:self-center"
                    >
                      <Database className="mr-1 h-3 w-3" />
                      {s.source ?? "local"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <PluginSlot name="sessions:bottom" />
      </div>
      {showList && (
        <SessionsMobileSearch
          search={search}
          searching={searching}
          onSearchChange={updateSearch}
        />
      )}
    </div>
  );
}

interface SessionRowProps {
  isExpanded: boolean;
  isSelected: boolean;
  onDelete: () => void;
  onExport: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  openInChatOnRow: boolean;
  onSelectClick: (event: React.MouseEvent) => void;
  onToggle: () => void;
  resumeInChatEnabled: boolean;
  searchQuery?: string;
  session: SessionInfo;
  snippet?: string;
}

interface SessionsPaginationProps {
  className?: string;
  compact?: boolean;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}

interface MobilePinnedSessionCardProps {
  onOpen: () => void;
  resumeInChatEnabled: boolean;
  session: SessionInfo;
}

interface SessionsMobileSearchProps {
  onSearchChange: (value: string) => void;
  search: string;
  searching: boolean;
}
