import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Edit3,
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
  Pin,
} from "lucide-react";
import { api } from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
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
import { mobilePreviewChatMessages } from "@/lib/mobilePreview";

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

function mobileChatResumePath(sessionId: string): string {
  return `/chat?mobile=1&resume=${encodeURIComponent(sessionId)}`;
}

function sessionDisplayTitle(session: SessionInfo): string {
  if (session.title && session.title !== "Untitled") return session.title;
  if (session.preview) return session.preview.slice(0, 72);
  return "Untitled session";
}

function sessionPreviewText(session: SessionInfo): string {
  return session.pending_summary?.trim() || session.preview?.trim() || "No recent transcript preview yet.";
}

function highlightedTextParts(text: string, query?: string): React.ReactNode {
  const terms = query
    ?.toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1);
  if (!terms?.length) return text;

  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "ig",
  );

  return text.split(pattern).map((part, index) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={`${part}-${index}`} className="hermes-mobile-search-mark">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function resistedSwipeOffset(dx: number): number {
  const limit = 92;
  const sign = Math.sign(dx);
  const abs = Math.abs(dx);
  if (abs <= 64) return dx;
  const resisted = 64 + (abs - 64) * 0.38;
  return sign * Math.min(limit, resisted);
}

function sessionActiveTimeMs(session: SessionInfo): number {
  return session.last_active < 1_000_000_000_000
    ? session.last_active * 1000
    : session.last_active;
}

function isRecentlyUpdatedSession(session: SessionInfo): boolean {
  if (session.is_active) return true;
  return Date.now() - sessionActiveTimeMs(session) < 10 * 60 * 1000;
}

function pendingKindLabel(kind?: string): string {
  if (kind === "approval") return "Approval";
  if (kind === "clarify") return "Question";
  if (kind === "sudo") return "Sudo";
  if (kind === "secret") return "Secret";
  return "Needs input";
}

function liveStatusLabel(status?: string): string {
  if (status === "starting") return "Starting";
  if (status === "waiting") return "Waiting";
  if (status === "working") return "Working";
  return "Live";
}

function waitingInputAlertKey(session: SessionInfo): string {
  return [
    session.pending_kind || "input",
    session.pending_request_id || session.live_session_id || session.id,
  ].join(":");
}

function waitingInputAlertTitle(session: SessionInfo): string {
  if (session.pending_kind === "approval") return "Hermes needs approval";
  if (session.pending_kind === "clarify") return "Hermes has a question";
  if (session.pending_kind === "sudo") return "Sudo password needed";
  if (session.pending_kind === "secret") return "Secret needed";
  return "Hermes needs input";
}

function waitingInputAlertBody(session: SessionInfo): string {
  return session.pending_summary || sessionPreviewText(session);
}

type BlockerChoice = "always" | "deny" | "once" | "session";

async function sendWaitingInputResponse(
  session: SessionInfo,
  response: { answer?: string; choice?: BlockerChoice; value?: string },
) {
  const gateway = new GatewayClient();
  await gateway.connect();
  try {
    if (session.pending_kind === "approval") {
      await gateway.request("approval.respond", {
        choice: response.choice ?? "deny",
        session_id: session.live_session_id || session.id,
      });
      return;
    }

    const requestId = session.pending_request_id;
    if (!requestId) throw new Error("This request is no longer waiting.");

    if (session.pending_kind === "clarify") {
      await gateway.request("clarify.respond", {
        answer: response.answer ?? "",
        request_id: requestId,
      });
      return;
    }

    if (session.pending_kind === "sudo") {
      await gateway.request("sudo.respond", {
        password: response.value ?? "",
        request_id: requestId,
      });
      return;
    }

    if (session.pending_kind === "secret") {
      await gateway.request("secret.respond", {
        request_id: requestId,
        value: response.value ?? "",
      });
      return;
    }

    throw new Error("This session is not waiting for input.");
  } finally {
    gateway.close();
  }
}

async function interruptLiveSession(session: SessionInfo) {
  const liveSessionId = session.live_session_id || session.id;
  if (!liveSessionId) throw new Error("No live session is attached.");
  const gateway = new GatewayClient();
  await gateway.connect();
  try {
    await gateway.request("session.interrupt", {
      session_id: liveSessionId,
    });
  } finally {
    gateway.close();
  }
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
  isPinned,
  isMobile,
  isOpening,
  onToggle,
  onSelectClick,
  onOpenInChat,
  onPin,
  onArchive,
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
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeOpen, setSwipeOpen] = useState<"left" | "right" | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const hasTitle = Boolean(session.title && session.title !== "Untitled");
  const titleText = hasTitle && session.title
    ? session.title
    : session.preview
      ? session.preview.slice(0, 60)
      : t.sessions.untitledSession;
  const mobileTone = mobileSessionTone(session);
  const isRecentlyUpdated = isRecentlyUpdatedSession(session);
  const showMobilePreview = Boolean(
    isMobile &&
      hasTitle &&
      session.preview?.trim() &&
      titleText.length <= 72 &&
      !snippet,
  );
  const openInChat = () => {
    if (!resumeInChatEnabled) return;
    if (openInChatOnRow) {
      onOpenInChat(session.id);
    } else {
      navigate(`/chat?resume=${encodeURIComponent(session.id)}`);
    }
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
            if (openInChatOnRow) {
              onOpenInChat(session.id);
            } else {
              navigate(`/chat?resume=${encodeURIComponent(session.id)}`);
            }
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

  const closeSwipe = useCallback(() => {
    setSwipeOpen(null);
    setSwipeOffset(0);
  }, []);

  const handleTouchStart = (event: React.TouchEvent) => {
    if (!isMobile) return;
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!isMobile || !swipeStartRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - swipeStartRef.current.x;
    const dy = touch.clientY - swipeStartRef.current.y;
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 12) return;
    event.stopPropagation();
    const clamped = resistedSwipeOffset(dx);
    setSwipeOpen(null);
    setSwipeOffset(clamped);
  };

  const handleTouchEnd = () => {
    if (!isMobile) return;
    if (swipeOffset > MOBILE_SWIPE_THRESHOLD) {
      setSwipeOpen("right");
      setSwipeOffset(72);
    } else if (swipeOffset < -MOBILE_SWIPE_THRESHOLD) {
      setSwipeOpen("left");
      setSwipeOffset(-92);
    } else {
      closeSwipe();
    }
    swipeStartRef.current = null;
  };

  return (
    <div
      className={`hermes-mobile-session-row-card group relative max-w-full min-w-0 overflow-hidden border transition-colors max-sm:min-h-[4.35rem] max-sm:shrink-0 max-sm:rounded-[0.82rem] max-sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_10px_28px_rgba(0,0,0,0.1)] max-sm:backdrop-blur-md ${containerClasses}`}
      data-swipe-open={swipeOpen ?? undefined}
      data-swipe-active={Math.abs(swipeOffset) > 12 ? "true" : undefined}
      data-opening={isOpening ? "true" : undefined}
    >
      <div
        aria-hidden={!isMobile}
        className="hermes-mobile-swipe-actions hermes-mobile-swipe-actions--pin"
      >
        <button
          type="button"
          className="hermes-mobile-swipe-button"
          tabIndex={isMobile ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            onPin();
            closeSwipe();
          }}
        >
          <Pin className="h-4 w-4" />
          <span>{isPinned ? "Pinned" : "Pin"}</span>
        </button>
      </div>
      <div
        aria-hidden={!isMobile}
        className="hermes-mobile-swipe-actions hermes-mobile-swipe-actions--manage"
      >
        <button
          type="button"
          className="hermes-mobile-swipe-button"
          tabIndex={isMobile ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            onArchive();
            closeSwipe();
          }}
        >
          <Archive className="h-4 w-4" />
          <span>Archive</span>
        </button>
        <button
          type="button"
          className="hermes-mobile-swipe-button hermes-mobile-swipe-button--delete"
          tabIndex={isMobile ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
            closeSwipe();
          }}
        >
          <Trash2 className="h-4 w-4" />
          <span>Delete</span>
        </button>
      </div>
      <div
        className="hermes-mobile-session-row-content relative z-10 flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-secondary/30 max-sm:min-h-[4.35rem] max-sm:gap-1 max-sm:p-2"
        style={
          isMobile && swipeOffset !== 0
            ? { transform: `translateX(${swipeOffset}px)` }
            : undefined
        }
        onClick={(event) => {
          if (swipeOpen) {
            event.stopPropagation();
            closeSwipe();
            return;
          }
          if (openInChatOnRow && resumeInChatEnabled) openInChat();
          else onToggle();
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={closeSwipe}
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
                    className={`hermes-mobile-session-title font-mondwest normal-case min-w-0 flex-1 truncate text-sm max-sm:text-[0.74rem] max-sm:leading-[1.03] ${hasTitle ? "font-medium" : "text-muted-foreground italic"}`}
                  >
                    {highlightedTextParts(titleText, searchQuery)}
                  </span>
                )}
                {isMobile && isRecentlyUpdated && (
                  <span
                    aria-label={session.is_active ? t.common.live : "Recent"}
                    className="hermes-mobile-session-fresh-dot"
                  />
                )}
                {session.is_active && (
                  <Badge tone="success" className="shrink-0 text-xs max-sm:hidden">
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    {t.common.live}
                  </Badge>
                )}
              </div>
              {showMobilePreview && (
                <p className="hermes-mobile-session-preview min-w-0 max-w-full truncate text-xs text-text-secondary">
                  {session.preview}
                </p>
              )}
              <div className="hermes-mobile-session-meta flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground max-sm:text-[0.52rem] max-sm:leading-tight">
                <span className="hermes-mobile-session-model max-w-[min(100%,12rem)] truncate sm:max-w-[180px] max-sm:max-w-[5.25rem]">
                  {(session.model ?? t.common.unknown).split("/").pop()}
                </span>
                <span className="hermes-mobile-session-dot text-border">&#183;</span>
                <span className="hermes-mobile-session-count shrink-0">
                  {session.message_count} {t.common.msgs}
                </span>
                {session.tool_call_count > 0 && (
                  <>
                    <span className="hermes-mobile-session-dot text-border">&#183;</span>
                    <span className="hermes-mobile-session-tools shrink-0">
                      {session.tool_call_count} {t.common.tools}
                    </span>
                  </>
                )}
                <span className="hermes-mobile-session-dot text-border">&#183;</span>
                <span className="hermes-mobile-session-time shrink-0">{timeAgo(session.last_active)}</span>
              </div>
              {snippet && <SnippetHighlight snippet={snippet} />}
            </div>

            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {actionButtons}
            </div>
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
type PinnedRailRubberbandEdge = "left" | "right";

const PAGE_SIZE = 20;
const DESKTOP_PINNED_SESSIONS_KEY = "hermes.desktop.pinnedSessions";
const DESKTOP_PINNED_FETCH_LIMIT = 200;
const MOBILE_SWIPE_THRESHOLD = 56;
const MOBILE_LONG_PRESS_MS = 420;

type MobileSessionGroupId = "today" | "yesterday" | "older";

interface MobileSessionGroup {
  id: MobileSessionGroupId;
  label: string;
  sessions: SessionInfo[];
}

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

function mobileSessionGroupId(session: SessionInfo): MobileSessionGroupId {
  const activeTime =
    session.last_active < 1_000_000_000_000
      ? session.last_active * 1000
      : session.last_active;
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  if (activeTime >= todayStart) return "today";
  if (activeTime >= yesterdayStart) return "yesterday";
  return "older";
}

function mobileSessionGroups(sessions: SessionInfo[]): MobileSessionGroup[] {
  const labels: Record<MobileSessionGroupId, string> = {
    today: "Today",
    yesterday: "Yesterday",
    older: "Older",
  };
  const grouped = new Map<MobileSessionGroupId, SessionInfo[]>([
    ["today", []],
    ["yesterday", []],
    ["older", []],
  ]);

  for (const session of sessions) {
    grouped.get(mobileSessionGroupId(session))?.push(session);
  }

  return (["today", "yesterday", "older"] as const)
    .map((id) => ({
      id,
      label: labels[id],
      sessions: grouped.get(id) ?? [],
    }))
    .filter((group) => group.sessions.length > 0);
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
  onFocusChange,
  search,
  searching,
}: SessionsMobileSearchProps) {
  const { t } = useI18n();

  return (
    <form
      role="search"
      className="hermes-mobile-composer hermes-mobile-app-composer hermes-session-search-glass shrink-0 px-3 py-2 sm:hidden"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex items-end gap-2">
        <span
          aria-hidden="true"
          className="hermes-session-search-icon hermes-ios-tap mb-0.5 grid h-12 w-12 shrink-0 place-items-center rounded-full border border-midground/20 bg-midground/10 p-0 text-midground"
        >
          <Search className="h-5 w-5" />
        </span>
        <Input
          type="search"
          placeholder="Search sessions..."
          value={search}
          onFocus={() => onFocusChange(true)}
          onBlur={() => {
            if (!search) onFocusChange(false);
          }}
          onChange={(event) => onSearchChange(event.target.value)}
          className="hermes-mobile-composer-field h-12 min-w-0 flex-1 px-4 py-3 text-base leading-6 shadow-none placeholder:text-text-secondary/65 focus-visible:ring-0"
        />
        {searching && (
          <Spinner className="mb-3.5 shrink-0 text-[0.875rem] text-primary" />
        )}
        <Button
          type="button"
          onClick={() => onSearchChange("")}
          disabled={!search}
          aria-label={t.common.clear}
          className="hermes-session-search-clear hermes-ios-tap mb-0.5 flex h-12 min-h-12 w-12 min-w-12 shrink-0 items-center justify-center rounded-full border border-midground/20 bg-midground/10 p-0 text-center text-midground shadow-[0_0_24px_rgba(45,212,191,0.16)] disabled:opacity-35 disabled:shadow-none"
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
  isOpening,
  onOpen,
  onMenuOpen,
  resumeInChatEnabled,
  session,
}: MobilePinnedSessionCardProps) {
  const hasTitle = session.title && session.title !== "Untitled";
  const mobileTone = mobileSessionTone(session);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOpenedRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    clearLongPress();
    longPressOpenedRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressOpenedRef.current = true;
      onMenuOpen();
      longPressTimerRef.current = null;
    }, MOBILE_LONG_PRESS_MS);
  };

  return (
    <div className="hermes-mobile-pinned-card-wrap relative min-w-0">
      <button
        type="button"
        className={`hermes-mobile-pinned-card group flex min-h-[4.35rem] min-w-0 flex-col rounded-[0.82rem] border px-2 py-1.5 text-left backdrop-blur-md transition-colors ${mobileTone.pinned}`}
        data-opening={isOpening ? "true" : undefined}
        disabled={!resumeInChatEnabled}
        onClick={() => {
          if (longPressOpenedRef.current) {
            longPressOpenedRef.current = false;
            return;
          }
          onOpen();
        }}
        onPointerDown={startLongPress}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onPointerCancel={clearLongPress}
        onContextMenu={(event) => {
          event.preventDefault();
          clearLongPress();
          onMenuOpen();
        }}
      >
        <div className="hermes-mobile-pinned-card-title flex min-w-0 items-start text-midground">
          <span className="font-mondwest normal-case min-w-0 flex-1 text-[0.74rem] font-medium leading-[1.03] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {hasTitle
              ? session.title
              : session.preview
                ? session.preview.slice(0, 48)
                : "Untitled session"}
          </span>
        </div>

        <div className="hermes-mobile-pinned-card-meta mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-mono-ui text-[0.52rem] leading-tight text-text-secondary">
          <span>{session.message_count} msgs</span>
          <span className="hermes-mobile-session-dot">·</span>
          <span>{timeAgo(session.last_active)}</span>
        </div>
      </button>
    </div>
  );
}

function MobilePinnedActionSheet({
  onArchive,
  onClose,
  onDelete,
  onRename,
  onUnpin,
  session,
}: MobilePinnedActionSheetProps) {
  if (!session) return null;
  const title =
    session.title && session.title !== "Untitled"
      ? session.title
      : session.preview
        ? session.preview.slice(0, 72)
        : "Untitled session";

  return (
    <div
      className="hermes-mobile-action-sheet-backdrop sm:hidden"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="hermes-mobile-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Pinned session actions"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hermes-mobile-action-sheet-handle" aria-hidden="true" />
        <div className="hermes-mobile-action-sheet-title">
          <span>{title}</span>
          <span>{session.message_count} msgs · {timeAgo(session.last_active)}</span>
        </div>
        <div className="hermes-mobile-action-sheet-actions">
          <button type="button" onClick={onUnpin}>
            <Pin className="h-5 w-5" />
            <span>Unpin</span>
          </button>
          <button type="button" onClick={onRename}>
            <Edit3 className="h-5 w-5" />
            <span>Rename</span>
          </button>
          <button type="button" onClick={onArchive}>
            <Archive className="h-5 w-5" />
            <span>Archive</span>
          </button>
          <button
            type="button"
            className="hermes-mobile-action-sheet-danger"
            onClick={onDelete}
          >
            <Trash2 className="h-5 w-5" />
            <span>Delete</span>
          </button>
        </div>
        <button
          type="button"
          className="hermes-mobile-action-sheet-cancel"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MobileAttentionInbox({
  attentionCount,
  notificationPermission,
  onOpenSession,
  onRequestNotifications,
  sessions,
}: {
  attentionCount: number;
  notificationPermission: NotificationPermission | "unsupported";
  onOpenSession: (session: SessionInfo) => void;
  onRequestNotifications: () => Promise<void>;
  sessions: SessionInfo[];
}) {
  const waiting = attentionCount > 0;
  const visible = sessions.slice(0, 3);
  const hasLiveWork = visible.some(
    (session) =>
      session.is_active ||
      Boolean(session.pending_kind) ||
      Boolean(session.live_status && session.live_status !== "idle"),
  );
  const showRows = waiting || hasLiveWork;
  const title = waiting ? "Needs input" : hasLiveWork ? "Active work" : "All clear";
  const detail = waiting
    ? `${attentionCount} decision${attentionCount === 1 ? "" : "s"} waiting`
    : hasLiveWork
      ? `${visible.length} live session${visible.length === 1 ? "" : "s"} to check`
      : "No live sessions need you right now";

  return (
    <section
      className="hermes-mobile-attention-inbox sm:hidden"
      data-state={waiting ? "waiting" : hasLiveWork ? "active" : "clear"}
    >
      <div className="hermes-mobile-attention-head">
        <span className="hermes-mobile-attention-icon">
          {waiting ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          <span className="block truncate">{detail}</span>
        </span>
        {notificationPermission === "default" && (
          <button
            type="button"
            className="hermes-mobile-attention-alerts"
            onClick={() => void onRequestNotifications()}
          >
            Notify me
          </button>
        )}
      </div>
      {showRows && visible.length > 0 && (
        <div className="hermes-mobile-attention-list">
          {visible.map((session) => (
            <button
              key={`attention-${session.id}`}
              type="button"
              className="hermes-mobile-attention-row"
              onClick={() => onOpenSession(session)}
            >
              <span className="min-w-0 flex-1">
                <span>{sessionDisplayTitle(session)}</span>
                <span>
                  {session.pending_kind
                    ? `${pendingKindLabel(session.pending_kind)} waiting`
                    : session.live_status && session.live_status !== "idle"
                      ? liveStatusLabel(session.live_status)
                    : session.is_active
                      ? "Live"
                      : timeAgo(session.last_active)} · {session.message_count} msgs
                </span>
              </span>
              <Play className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MobileSessionPreviewSheet({
  onClose,
  onContinue,
  onInterrupt,
  onResolved,
  session,
}: {
  onClose: () => void;
  onContinue: (id: string) => void;
  onInterrupt: (session: SessionInfo) => Promise<void>;
  onResolved: () => void;
  session: SessionInfo | null;
}) {
  const [messages, setMessages] = useState<SessionMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");
  const [responding, setResponding] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [interrupting, setInterrupting] = useState(false);

  useEffect(() => {
    if (!session) {
      // Sheet close resets the preview payload for the next session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(null);
      setError(null);
      setResponseDraft("");
      setResponseError(null);
      setResponding(null);
      setInterrupting(false);
      return;
    }

    const shouldLoadRecentMessages =
      !session.pending_kind &&
      !(session.live_status && session.live_status !== "idle");

    if (!shouldLoadRecentMessages) {
      setLoading(false);
      setError(null);
      setMessages(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages(null);
    api
      .getSessionMessages(session.id)
      .then((resp) => {
        if (!cancelled) {
          setMessages(mobilePreviewChatMessages(resp.messages));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  const isPending = Boolean(session.pending_kind);
  const isLiveActive = !isPending && Boolean(session.live_status && session.live_status !== "idle");
  const submitResponse = async (
    action: string,
    response: { answer?: string; choice?: BlockerChoice; value?: string },
  ) => {
    setResponding(action);
    setResponseError(null);
    try {
      await sendWaitingInputResponse(session, response);
      navigator.vibrate?.(action === "deny" ? 12 : 8);
      setResponseDraft("");
      onResolved();
      onClose();
    } catch (err) {
      setResponseError(err instanceof Error ? err.message : String(err));
      setResponding(null);
    }
  };
  const busy = responding !== null;
  const pendingChoices = Array.isArray(session.pending_choices)
    ? session.pending_choices.filter(Boolean)
    : [];
  const handleInterrupt = async () => {
    setInterrupting(true);
    setResponseError(null);
    try {
      await onInterrupt(session);
      navigator.vibrate?.(12);
      onResolved();
      onClose();
    } catch (err) {
      setResponseError(err instanceof Error ? err.message : String(err));
      setInterrupting(false);
    }
  };

  return (
    <div
      className="hermes-mobile-action-sheet-backdrop hermes-mobile-preview-backdrop sm:hidden"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="hermes-mobile-action-sheet hermes-mobile-session-preview-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Session preview"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hermes-mobile-action-sheet-handle" aria-hidden="true" />
        <div className="hermes-mobile-preview-title">
          <span>{sessionDisplayTitle(session)}</span>
          <span>
            {session.pending_kind
              ? `${pendingKindLabel(session.pending_kind)} waiting`
              : session.live_status && session.live_status !== "idle"
                ? `${liveStatusLabel(session.live_status)} · ${timeAgo(session.last_active)}`
              : `${session.source ?? "local"} · ${session.message_count} msgs · ${timeAgo(session.last_active)}`}
          </span>
        </div>
        <p className="hermes-mobile-preview-summary">{sessionPreviewText(session)}</p>
        {isLiveActive && (
          <div className="hermes-mobile-preview-active" aria-label="Active work controls">
            <div className="hermes-mobile-preview-active-head">
              <Clock className="h-4 w-4" />
              <span>{liveStatusLabel(session.live_status)}</span>
            </div>
            <div className="hermes-mobile-preview-active-body">
              {session.live_inflight_user && (
                <div>
                  <span>Request</span>
                  <p>{session.live_inflight_user}</p>
                </div>
              )}
              {session.live_inflight_assistant && (
                <div>
                  <span>Latest</span>
                  <p>{session.live_inflight_assistant}</p>
                </div>
              )}
              {!session.live_inflight_user && !session.live_inflight_assistant && (
                <div>
                  <span>Status</span>
                  <p>{sessionPreviewText(session)}</p>
                </div>
              )}
              <div className="hermes-mobile-preview-active-meta">
                <span>{session.model || "model pending"}</span>
                <span>{timeAgo(session.last_active)}</span>
              </div>
            </div>
            <div className="hermes-mobile-preview-active-actions">
              <button
                type="button"
                disabled={interrupting}
                onClick={() => void handleInterrupt()}
              >
                {interrupting ? "Stopping..." : "Interrupt"}
              </button>
            </div>
            {responseError && (
              <div className="hermes-mobile-preview-response-error">{responseError}</div>
            )}
          </div>
        )}
        {isPending && (
          <div className="hermes-mobile-preview-blocker" aria-label="Waiting input controls">
            <div className="hermes-mobile-preview-blocker-head">
              <AlertTriangle className="h-4 w-4" />
              <span>{pendingKindLabel(session.pending_kind)} needed</span>
            </div>
            {session.pending_kind === "approval" && (
              <div className="hermes-mobile-preview-blocker-body">
                <p>{session.pending_description || "Hermes needs approval to continue."}</p>
                {session.pending_command && (
                  <code>{session.pending_command}</code>
                )}
                <div className="hermes-mobile-preview-blocker-grid">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitResponse("deny", { choice: "deny" })}
                  >
                    {responding === "deny" ? "Sending..." : "Deny"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitResponse("once", { choice: "once" })}
                  >
                    {responding === "once" ? "Sending..." : "Allow once"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitResponse("session", { choice: "session" })}
                  >
                    {responding === "session" ? "Sending..." : "Allow session"}
                  </button>
                  {session.pending_allow_permanent !== false && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitResponse("always", { choice: "always" })}
                    >
                      {responding === "always" ? "Sending..." : "Allow always"}
                    </button>
                  )}
                </div>
              </div>
            )}
            {session.pending_kind === "clarify" && (
              <div className="hermes-mobile-preview-blocker-body">
                <p>{session.pending_question || "Hermes needs an answer."}</p>
                {pendingChoices.length > 0 && (
                  <div className="hermes-mobile-preview-choice-list">
                    {pendingChoices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={busy}
                        onClick={() => void submitResponse("clarify", { answer: choice })}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="hermes-mobile-preview-response-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (responseDraft.trim()) {
                      void submitResponse("clarify", { answer: responseDraft.trim() });
                    }
                  }}
                >
                  <textarea
                    value={responseDraft}
                    rows={2}
                    disabled={busy}
                    onChange={(event) => setResponseDraft(event.target.value)}
                    placeholder="Type an answer"
                  />
                  <button type="submit" disabled={busy || !responseDraft.trim()}>
                    Send
                  </button>
                </form>
              </div>
            )}
            {(session.pending_kind === "sudo" || session.pending_kind === "secret") && (
              <form
                className="hermes-mobile-preview-blocker-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (responseDraft) {
                    void submitResponse(session.pending_kind || "secure", { value: responseDraft });
                  }
                }}
              >
                <p>
                  {session.pending_kind === "sudo"
                    ? "Enter the password for this one sudo request."
                    : session.pending_prompt || `Enter ${session.pending_env_var || "the requested secret"}.`}
                </p>
                <div className="hermes-mobile-preview-response-form">
                  <input
                    value={responseDraft}
                    disabled={busy}
                    onChange={(event) => setResponseDraft(event.target.value)}
                    placeholder={session.pending_kind === "sudo" ? "Password" : session.pending_env_var || "Secret value"}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="submit" disabled={busy || !responseDraft}>
                    Send
                  </button>
                </div>
              </form>
            )}
            {responseError && (
              <div className="hermes-mobile-preview-response-error">{responseError}</div>
            )}
          </div>
        )}
        {!isLiveActive && !isPending && (
          <div className="hermes-mobile-preview-messages" aria-label="Recent messages">
            {loading && <div className="hermes-mobile-preview-empty">Loading preview...</div>}
            {error && <div className="hermes-mobile-preview-empty">{error}</div>}
            {!loading && !error && messages?.length === 0 && (
              <div className="hermes-mobile-preview-empty">No messages in this session yet.</div>
            )}
            {!loading && !error && messages?.map((message, index) => (
              <div key={`${message.role}-${message.timestamp ?? index}`} className="hermes-mobile-preview-message">
                <span>{message.role === "assistant" ? "Hermes" : "You"}</span>
                <p>{message.content || "No content"}</p>
              </div>
            ))}
          </div>
        )}
        <div className="hermes-mobile-preview-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={() => onContinue(session.id)}>
            <Play className="h-4 w-4" />
            <span>Continue here</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    SessionSearchResult[] | null
  >(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const logScrollRef = useRef<HTMLPreElement | null>(null);
  const mobileScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionHistoryRef = useRef<HTMLDivElement | null>(null);
  const pinnedRailPointerXRef = useRef<number | null>(null);
  const pinnedRailTouchXRef = useRef<number | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [overviewSessions, setOverviewSessions] = useState<SessionInfo[]>([]);
  const [mobileWaitingInputSessions, setMobileWaitingInputSessions] = useState<SessionInfo[]>([]);
  const [mobileActiveWorkSessions, setMobileActiveWorkSessions] = useState<SessionInfo[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [desktopPinnedSessionIds, setDesktopPinnedSessionIds] = useState<string[]>(
    () => readDesktopPinnedSessionIds(),
  );
  const [pinnedMenuId, setPinnedMenuId] = useState<string | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [mobileAttentionCount, setMobileAttentionCount] = useState(0);
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [activePinnedPage, setActivePinnedPage] = useState(0);
  const [pinnedRailRubberband, setPinnedRailRubberband] =
    useState<PinnedRailRubberbandEdge | null>(null);
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
  const pinnedRailRubberbandTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedWaitingAlertsRef = useRef(false);
  const notifiedWaitingKeysRef = useRef<Set<string>>(new Set());
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
  const location = useLocation();
  const forceMobileSurface = new URLSearchParams(location.search).get("mobile") === "1";
  const resumeInChatEnabled = isDashboardEmbeddedChatEnabled();
  const belowMobileBreakpoint = useBelowBreakpoint(640);
  const isMobile = belowMobileBreakpoint || forceMobileSurface;

  const requestNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      showToast("Browser alerts are unavailable here", "error");
      return;
    }
    const next = await Notification.requestPermission();
    setNotificationPermission(next);
    if (next === "granted") {
      showToast("Mobile attention alerts enabled", "success");
    } else if (next === "denied") {
      showToast("Alerts blocked in browser settings", "error");
    }
  }, [showToast]);

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

  const syncSessionListScrolled = useCallback((el: HTMLDivElement) => {
    const update = () => {
      const scrolled = el.scrollTop > 260;
      setSessionListScrolled((current) =>
        current === scrolled ? current : scrolled,
      );
    };

    update();
    window.requestAnimationFrame(update);
    window.setTimeout(update, 220);
    window.setTimeout(update, 620);
  }, []);

  const triggerPinnedRailRubberband = useCallback(
    (edge: PinnedRailRubberbandEdge) => {
      if (!isMobile) return;
      if (pinnedRailRubberbandTimerRef.current) {
        clearTimeout(pinnedRailRubberbandTimerRef.current);
      }
      setPinnedRailRubberband(null);
      window.requestAnimationFrame(() => setPinnedRailRubberband(edge));
      pinnedRailRubberbandTimerRef.current = setTimeout(() => {
        setPinnedRailRubberband(null);
        pinnedRailRubberbandTimerRef.current = null;
      }, 520);
    },
    [isMobile],
  );

  const maybeRubberbandPinnedRail = useCallback(
    (el: HTMLDivElement, deltaX: number) => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      if (maxScrollLeft <= 1 || Math.abs(deltaX) < 10) return;
      if (el.scrollLeft <= 1 && deltaX < 0) {
        triggerPinnedRailRubberband("left");
      } else if (el.scrollLeft >= maxScrollLeft - 1 && deltaX > 0) {
        triggerPinnedRailRubberband("right");
      }
    },
    [triggerPinnedRailRubberband],
  );

  const updateActivePinnedPage = useCallback((el: HTMLDivElement, pageCount: number) => {
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    const lastPage = Math.max(0, pageCount - 1);
    if (maxScrollLeft <= 1 || lastPage === 0) {
      setActivePinnedPage(0);
      return;
    }
    const page = Math.round((el.scrollLeft / maxScrollLeft) * lastPage);
    setActivePinnedPage((current) =>
      current === page ? current : Math.max(0, Math.min(lastPage, page)),
    );
  }, []);

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

  const loadMobileWaitingInput = useCallback(() => {
    api
      .getWaitingInputSessions(10)
      .then((r) => {
        const waiting = r.sessions.slice().sort(newestFirst);
        setMobileWaitingInputSessions(waiting);
        setMobileAttentionCount(r.total);
      })
      .catch(() => {});
  }, []);

  const loadMobileActiveWork = useCallback(() => {
    api
      .getActiveWorkSessions(10)
      .then((r) => {
        setMobileActiveWorkSessions(r.sessions.slice().sort(newestFirst));
      })
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
      loadMobileWaitingInput();
      loadMobileActiveWork();
    };
    loadOverview();
    const id = setInterval(loadOverview, 5000);
    return () => clearInterval(id);
  }, [loadMobileActiveWork, loadMobileWaitingInput]);

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
    let cancelled = false;

    const refreshSharedPinned = () => {
      api
        .getPinnedSessions()
        .then((resp) => {
          if (!cancelled) {
            setDesktopPinnedSessionIds(resp.ids);
          }
        })
        .catch(() => {
          // Shared pins are best-effort; local dashboard storage remains a
          // fallback for same-origin development builds.
        });
    };

    refreshSharedPinned();
    window.addEventListener("focus", refreshSharedPinned);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshSharedPinned);
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
      if (pinnedRailRubberbandTimerRef.current) {
        clearTimeout(pinnedRailRubberbandTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onMobileAttention = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: unknown }>).detail;
      const count = typeof detail?.count === "number" && Number.isFinite(detail.count)
        ? Math.max(0, Math.floor(detail.count))
        : 0;
      setMobileAttentionCount(count);
    };
    window.addEventListener("hermes-mobile-attention", onMobileAttention);
    return () => window.removeEventListener("hermes-mobile-attention", onMobileAttention);
  }, []);

  useEffect(() => {
    const currentKeys = new Set(mobileWaitingInputSessions.map(waitingInputAlertKey));
    for (const key of Array.from(notifiedWaitingKeysRef.current)) {
      if (!currentKeys.has(key)) notifiedWaitingKeysRef.current.delete(key);
    }

    if (!initializedWaitingAlertsRef.current) {
      initializedWaitingAlertsRef.current = true;
      notifiedWaitingKeysRef.current = currentKeys;
      return;
    }

    const fresh = mobileWaitingInputSessions.filter((session) => {
      const key = waitingInputAlertKey(session);
      if (notifiedWaitingKeysRef.current.has(key)) return false;
      notifiedWaitingKeysRef.current.add(key);
      return true;
    });
    if (fresh.length === 0) return;

    const primary = fresh[0];
    const title = waitingInputAlertTitle(primary);
    const body = waitingInputAlertBody(primary);
    if (
      typeof Notification !== "undefined" &&
      notificationPermission === "granted" &&
      document.visibilityState !== "visible"
    ) {
      const note = new Notification(title, {
        body,
        tag: waitingInputAlertKey(primary),
      });
      note.onclick = () => {
        window.focus();
        window.location.assign("/sessions?mobile=1");
      };
      return;
    }

    navigator.vibrate?.(12);
    showToast(title, "success");
  }, [mobileWaitingInputSessions, notificationPermission, showToast]);

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
      if (value) setSearchFocused(true);
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

  const openMobileSession = useCallback(
    (sessionId: string) => {
      setOpeningSessionId(sessionId);
      setPreviewSessionId(null);
      window.setTimeout(() => {
        navigate(mobileChatResumePath(sessionId));
      }, 145);
    },
    [navigate],
  );

  const openMobilePreview = useCallback((sessionId: string) => {
    setPreviewSessionId(sessionId);
  }, []);

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

  const persistPinnedSessionIds = useCallback(
    (ids: string[]) => {
      setDesktopPinnedSessionIds(ids);
      try {
        window.localStorage.setItem(
          DESKTOP_PINNED_SESSIONS_KEY,
          JSON.stringify(ids),
        );
      } catch {
        // Local storage is a convenience only.
      }
      void api.setPinnedSessions(ids).catch(() => {
        showToast("Pinned sessions will sync after the dashboard reconnects", "error");
      });
    },
    [showToast],
  );

  const handlePinSession = useCallback(
    (session: SessionInfo) => {
      const pinId = sessionPinId(session);
      if (desktopPinnedSessionIds.includes(pinId)) return;
      persistPinnedSessionIds([...desktopPinnedSessionIds, pinId]);
      showToast("Pinned session", "success");
    },
    [desktopPinnedSessionIds, persistPinnedSessionIds, showToast],
  );

  const handleUnpinSession = useCallback(
    (session: SessionInfo) => {
      const ids = new Set([session.id, sessionPinId(session)]);
      const next = desktopPinnedSessionIds.filter((id) => !ids.has(id));
      persistPinnedSessionIds(next);
      setPinnedMenuId(null);
      showToast("Unpinned session", "success");
    },
    [desktopPinnedSessionIds, persistPinnedSessionIds, showToast],
  );

  const handleArchiveSession = useCallback(
    async (session: SessionInfo) => {
      try {
        await api.archiveSession(session.id, true);
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        setOverviewSessions((prev) => prev.filter((s) => s.id !== session.id));
        setTotal((prev) => Math.max(0, prev - 1));
        showToast("Archived session", "success");
        loadStats();
      } catch {
        showToast("Failed to archive session", "error");
      }
    },
    [loadStats, showToast],
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
    () => uniqueSessions([...mobileWaitingInputSessions, ...mobileActiveWorkSessions, ...overviewSessions, ...sessions]),
    [mobileActiveWorkSessions, mobileWaitingInputSessions, overviewSessions, sessions],
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
        ? pinnedDesktopSessions
        : [],
    [isMobile, isSearching, pinnedDesktopSessions],
  );
  const showMobilePinnedSessions = mobilePinnedSessions.length > 0;
  const mobilePinnedPageCount = Math.max(
    1,
    Math.ceil(mobilePinnedSessions.length / 2),
  );
  const displayedActivePinnedPage = Math.min(
    activePinnedPage,
    mobilePinnedPageCount - 1,
  );
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
  const mobileGroups = useMemo(
    () => mobileSessionGroups(visibleSessions),
    [visibleSessions],
  );
  const previewSession = useMemo(
    () => sessionPool.find((session) => session.id === previewSessionId) ?? null,
    [previewSessionId, sessionPool],
  );
  const mobileAttentionSessions = useMemo(
    () => {
      if (mobileWaitingInputSessions.length > 0) {
        return mobileWaitingInputSessions.slice().sort(newestFirst).slice(0, 3);
      }
      if (mobileActiveWorkSessions.length > 0) {
        return mobileActiveWorkSessions.slice().sort(newestFirst).slice(0, 3);
      }
      return sessionPool
        .filter((session) => session.is_active || isRecentlyUpdatedSession(session))
        .sort((a, b) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
          return newestFirst(a, b);
        })
        .slice(0, 3);
    },
    [mobileActiveWorkSessions, mobileWaitingInputSessions, sessionPool],
  );

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

  useEffect(() => {
    if (!isMobile || !searchFocused) return;
    mobileScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [isMobile, searchFocused, search]);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      setMobileKeyboardInset((current) =>
        Math.abs(current - inset) < 1 ? current : Math.round(inset),
      );
    };

    updateKeyboardInset();
    viewport.addEventListener("resize", updateKeyboardInset);
    viewport.addEventListener("scroll", updateKeyboardInset);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset);
      viewport.removeEventListener("scroll", updateKeyboardInset);
    };
  }, [isMobile]);

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

  const activePinnedActionSession =
    pinnedMenuId !== null
      ? mobilePinnedSessions.find((session) => session.id === pinnedMenuId) ?? null
      : null;

  return (
    <div
      data-force-mobile-sessions={forceMobileSurface ? "true" : "false"}
      className="hermes-mobile-sessions-shell hermes-mobile-app relative isolate flex min-h-0 w-full max-w-full flex-col overflow-hidden rounded-[1.65rem] sm:gap-4 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-0 sm:[background:transparent] sm:[backdrop-filter:none]"
      style={
        isMobile
          ? ({
              "--hermes-mobile-keyboard-inset": `${mobileKeyboardInset}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {!forceMobileSurface && <PluginSlot name="sessions:top" />}
      <Toast toast={toast} />
      <MobileSessionPreviewSheet
        session={previewSession}
        onClose={() => setPreviewSessionId(null)}
        onContinue={openMobileSession}
        onInterrupt={async (session) => {
          await interruptLiveSession(session);
          loadMobileActiveWork();
          loadMobileWaitingInput();
        }}
        onResolved={loadMobileWaitingInput}
      />

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

      <div className="hermes-mobile-sessions-header hermes-mobile-app-header grid h-14 shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 border-b border-current/20 px-4 sm:hidden">
        <button
          type="button"
          aria-label="Back to chat"
          onClick={() => navigate("/chat?mobile=1")}
          className="hermes-mobile-back-button hermes-ios-tap grid h-11 w-11 place-items-center rounded-full text-[1.85rem] leading-none"
        >
          ‹
        </button>
        <div className="mx-auto inline-flex min-w-0 items-center justify-center gap-2">
          <span className="hermes-mobile-shield grid h-7 w-7 shrink-0 place-items-center rounded-full text-white">
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="truncate text-[1.05rem] font-semibold tracking-[-0.02em]">
            Sessions
          </span>
        </div>
        <span aria-hidden="true" />
      </div>

      <div
        ref={mobileScrollRef}
        className="hermes-mobile-scroll hermes-mobile-sessions-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 pt-3 max-sm:overflow-hidden sm:contents sm:overflow-visible sm:p-0"
        data-history-scrolled={sessionListScrolled ? "true" : "false"}
      >

      {isMobile && !isSearching && (
        <MobileAttentionInbox
          attentionCount={mobileAttentionCount}
          notificationPermission={notificationPermission}
          sessions={mobileAttentionSessions}
          onRequestNotifications={requestNotifications}
          onOpenSession={(session) => openMobilePreview(session.id)}
        />
      )}

      {showMobilePinnedSessions && (
        <section className="hermes-session-pinned-glass px-0 sm:hidden">
          <button
            type="button"
            className="hermes-mobile-pinned-compact"
            onClick={() => {
              sessionHistoryRef.current?.scrollTo({
                top: 0,
                behavior: "smooth",
              });
              mobileScrollRef.current?.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }}
          >
            <span>Continue</span>
            <span>{mobilePinnedSessions.length} pinned</span>
          </button>
          <div className="hermes-mobile-pinned-header mb-2 flex items-center justify-between gap-2 px-1">
            <div className="font-mono-ui text-[0.64rem] font-medium uppercase tracking-[0.16em] text-emerald-100/80">
              Continue
            </div>
            <div className="font-mono-ui text-[0.62rem] uppercase tracking-[0.12em] text-text-secondary">
              {mobilePinnedSessions.length} pinned
            </div>
          </div>
          <div
            className="hermes-mobile-pinned-grid grid min-w-0 grid-cols-2 gap-1.5"
            data-pinned-rubberband={pinnedRailRubberband ?? undefined}
            onScroll={(event) =>
              updateActivePinnedPage(
                event.currentTarget,
                mobilePinnedPageCount,
              )
            }
            onPointerDown={(event) => {
              if (event.pointerType === "touch") return;
              pinnedRailPointerXRef.current = event.clientX;
            }}
            onPointerMove={(event) => {
              if (
                event.pointerType === "touch" ||
                pinnedRailPointerXRef.current == null
              ) {
                return;
              }
              maybeRubberbandPinnedRail(
                event.currentTarget,
                pinnedRailPointerXRef.current - event.clientX,
              );
            }}
            onPointerUp={() => {
              pinnedRailPointerXRef.current = null;
            }}
            onPointerLeave={() => {
              pinnedRailPointerXRef.current = null;
            }}
            onPointerCancel={() => {
              pinnedRailPointerXRef.current = null;
            }}
            onTouchStart={(event) => {
              pinnedRailTouchXRef.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchMove={(event) => {
              const x = event.touches[0]?.clientX;
              if (x == null || pinnedRailTouchXRef.current == null) return;
              maybeRubberbandPinnedRail(
                event.currentTarget,
                pinnedRailTouchXRef.current - x,
              );
            }}
            onTouchEnd={() => {
              pinnedRailTouchXRef.current = null;
            }}
            onTouchCancel={() => {
              pinnedRailTouchXRef.current = null;
            }}
            onWheel={(event) => {
              if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
              maybeRubberbandPinnedRail(event.currentTarget, event.deltaX);
            }}
          >
            {Array.from({ length: mobilePinnedPageCount }, (_, pageIndex) => (
              <div
                key={`pinned-page-${pageIndex}`}
                className="hermes-mobile-pinned-page"
              >
                {mobilePinnedSessions
                  .slice(pageIndex * 2, pageIndex * 2 + 2)
                  .map((s) => (
                    <MobilePinnedSessionCard
                      key={`pinned-${s.id}`}
                      session={s}
                      isOpening={openingSessionId === s.id}
                      onOpen={() => openMobilePreview(s.id)}
                      onMenuOpen={() => setPinnedMenuId(s.id)}
                      resumeInChatEnabled={resumeInChatEnabled}
                    />
                  ))}
              </div>
            ))}
          </div>
          <div
            className="hermes-mobile-pinned-dots"
            aria-label={`Pinned page ${displayedActivePinnedPage + 1} of ${mobilePinnedPageCount}`}
          >
            {Array.from({ length: mobilePinnedPageCount }, (_, index) => (
              <span
                key={`pinned-dot-${index}`}
                aria-hidden="true"
                data-active={index === displayedActivePinnedPage ? "true" : undefined}
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
                className="hidden shrink-0 sm:inline-flex"
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
          <div className="hermes-mobile-sessions-empty flex flex-col items-center justify-center py-16 text-muted-foreground">
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
              ref={sessionHistoryRef}
              className="hermes-ios-session-list grid min-w-0 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:flex sm:flex-col sm:gap-1.5 sm:overflow-visible sm:rounded-none sm:border-0 sm:pr-0"
              aria-label="Session history"
              data-scrolled={sessionListScrolled ? "true" : "false"}
              data-rubberband={sessionListRubberband ?? undefined}
              role="region"
              tabIndex={0}
              onScroll={(event) => {
                syncSessionListScrolled(event.currentTarget);
              }}
              onTouchStart={(event) => {
                sessionListTouchYRef.current = event.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(event) => {
                const y = event.touches[0]?.clientY;
                if (y == null || sessionListTouchYRef.current == null) return;
                maybeRubberbandSessionList(
                  event.currentTarget,
                  sessionListTouchYRef.current - y,
                );
              }}
              onTouchEnd={() => {
                if (sessionHistoryRef.current) {
                  syncSessionListScrolled(sessionHistoryRef.current);
                }
                sessionListTouchYRef.current = null;
              }}
              onWheel={(event) => {
                syncSessionListScrolled(event.currentTarget);
                maybeRubberbandSessionList(
                  event.currentTarget,
                  event.deltaY,
                );
              }}
            >
              {isMobile && (
                <div
                  className="hermes-mobile-pull-indicator"
                  aria-hidden="true"
                >
                  <span>Updated</span>
                </div>
              )}
              {(isMobile ? mobileGroups : [{ id: "older", label: "History", sessions: visibleSessions }]).map(
                (group) => (
                  <section
                    key={group.id}
                    className="hermes-mobile-session-group contents sm:contents"
                  >
                    {isMobile && (
                      <div className="hermes-mobile-session-group-label">
                        <span>{group.label}</span>
                        <span>{group.sessions.length}</span>
                      </div>
                    )}
                    {group.sessions.map((s) => {
                      const index = visibleSessions.findIndex(
                        (session) => session.id === s.id,
                      );
                      return (
                        <SessionRow
                          key={s.id}
                          session={s}
                          snippet={snippetMap.get(s.id)}
                          searchQuery={search || undefined}
                          isExpanded={expandedId === s.id}
                          isSelected={selectedIds.has(s.id)}
                          isPinned={desktopPinnedSessionIds.includes(
                            sessionPinId(s),
                          )}
                          isMobile={isMobile}
                          isOpening={openingSessionId === s.id}
                          onToggle={() =>
                            setExpandedId((prev) =>
                              prev === s.id ? null : s.id,
                            )
                          }
                          onOpenInChat={openMobilePreview}
                          onSelectClick={(event) =>
                            handleSelectClick(event, index, visibleSessions)
                          }
                          onPin={() => handlePinSession(s)}
                          onArchive={() => void handleArchiveSession(s)}
                          onDelete={() => sessionDelete.requestDelete(s.id)}
                          onRename={handleRename}
                          onExport={handleExport}
                          openInChatOnRow={isMobile}
                          resumeInChatEnabled={resumeInChatEnabled}
                        />
                      );
                    })}
                  </section>
                ),
              )}
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

      {!forceMobileSurface && <PluginSlot name="sessions:bottom" />}
      </div>
      {showList && (
        <SessionsMobileSearch
          search={search}
          searching={searching}
          onFocusChange={setSearchFocused}
          onSearchChange={updateSearch}
        />
      )}
      <MobilePinnedActionSheet
        session={activePinnedActionSession}
        onClose={() => setPinnedMenuId(null)}
        onUnpin={() => {
          if (!activePinnedActionSession) return;
          handleUnpinSession(activePinnedActionSession);
        }}
        onRename={() => {
          if (!activePinnedActionSession) return;
          const session = activePinnedActionSession;
          setPinnedMenuId(null);
          const title = window.prompt(
            "Rename session",
            session.title && session.title !== "Untitled" ? session.title : "",
          );
          if (title !== null) void handleRename(session.id, title);
        }}
        onArchive={() => {
          if (!activePinnedActionSession) return;
          const session = activePinnedActionSession;
          setPinnedMenuId(null);
          void handleArchiveSession(session);
        }}
        onDelete={() => {
          if (!activePinnedActionSession) return;
          const session = activePinnedActionSession;
          setPinnedMenuId(null);
          sessionDelete.requestDelete(session.id);
        }}
      />
    </div>
  );
}

interface SessionRowProps {
  isExpanded: boolean;
  isMobile: boolean;
  isOpening: boolean;
  isPinned: boolean;
  isSelected: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onExport: (id: string) => void;
  onOpenInChat: (id: string) => void;
  onPin: () => void;
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
  isOpening: boolean;
  onMenuOpen: () => void;
  onOpen: () => void;
  resumeInChatEnabled: boolean;
  session: SessionInfo;
}

interface MobilePinnedActionSheetProps {
  onArchive: () => void;
  onClose: () => void;
  onDelete: () => void;
  onRename: () => void;
  onUnpin: () => void;
  session: SessionInfo | null;
}

interface SessionsMobileSearchProps {
  onFocusChange: (focused: boolean) => void;
  onSearchChange: (value: string) => void;
  search: string;
  searching: boolean;
}
