import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import {
  AlertCircle,
  ArrowUp,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleStop,
  FileText,
  HelpCircle,
  Hourglass,
  KeyRound,
  List,
  Loader2,
  Lock,
  Mic,
  MoreHorizontal,
  Plus,
  Settings,
  ShieldCheck,
  TerminalSquare,
  X,
  Wrench,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { Markdown } from "@/components/Markdown";
import {
  applyGatewayEventToActivities,
  emptyActivityModel,
  getVisibleActivityCards,
  type AgentActivity,
} from "@/lib/agentActivity";
import { api, type ModelAssignmentResponse, type ModelOptionProvider, type ModelOptionsResponse } from "@/lib/api";
import { GatewayClient, type ConnectionState, type GatewayEvent } from "@/lib/gatewayClient";
import { cn } from "@/lib/utils";

interface MobileChatSurfaceProps {
  active: boolean;
  decisionPanelRequested?: boolean;
  onDecisionPanelClose?: () => void;
  profile?: string;
  resume?: string | null;
}

type ChatRole = "assistant" | "handoff" | "system" | "tool" | "user";

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
}

interface UsagePayload {
  context_max?: number;
  context_percent?: number;
  context_used?: number;
  total?: number;
}

interface SessionPayload {
  session_id?: string;
  stored_session_id?: string;
  resumed?: string;
  messages?: Array<{ role?: string; text?: string; content?: string; name?: string; context?: string }>;
  info?: {
    model?: string;
    provider?: string;
    cwd?: string;
    profile_name?: string;
    reasoning_effort?: string;
    usage?: UsagePayload;
  };
  running?: boolean;
}

interface HandoffCreateResult extends SessionPayload {
  handoff?: {
    summary?: string;
    source_message_count?: number;
  };
  source_session_id?: string;
}

interface TextPayload {
  text?: string;
  rendered?: string;
  status?: string;
  usage?: UsagePayload;
  warning?: string;
}


interface ClarifyPayload {
  choices?: string[] | null;
  question?: string;
  request_id?: string;
}

interface ApprovalPayload {
  allow_permanent?: boolean;
  command?: string;
  description?: string;
}

interface SudoPayload {
  request_id?: string;
}

interface SecretPayload {
  env_var?: string;
  prompt?: string;
  request_id?: string;
}

type NeedsInput =
  | {
      choices: string[];
      kind: "clarify";
      question: string;
      requestId: string;
    }
  | {
      allowPermanent: boolean;
      command: string;
      description: string;
      kind: "approval";
      sessionId?: string;
    }
  | {
      kind: "sudo";
      requestId: string;
    }
  | {
      envVar?: string;
      kind: "secret";
      prompt: string;
      requestId: string;
    };

type ApprovalChoice = "always" | "deny" | "once" | "session";

const REASONING_EFFORTS = [
  { caption: "Minimal", label: "Fast", value: "minimal" },
  { caption: "", label: "Low", value: "low" },
  { caption: "", label: "Medium", value: "medium" },
  { caption: "", label: "High", value: "high" },
  { caption: "Very high", label: "Max", value: "xhigh" },
] as const;

type ReasoningEffort = typeof REASONING_EFFORTS[number]["value"];

interface ModelParts {
  family: string;
  version: string;
}

interface ModelSelection {
  effort: ReasoningEffort;
  model: string;
  provider: string;
}

interface ModelApplyResult {
  confirm_message?: string;
  confirm_required?: boolean;
}

interface GatewayConfigSetResult {
  confirm_message?: string;
  confirm_required?: boolean;
  value?: string;
  warning?: string;
}

interface AttachmentResult {
  attached?: boolean;
  count?: number;
  filename?: string;
  name?: string;
  ref_text?: string;
  text?: string;
}

interface ComposerAttachment {
  id: string;
  kind: "file" | "image" | "pdf";
  name: string;
  text: string;
}

type ModelPickerName = "family" | "provider" | "version";

interface ModelPickerOption {
  label: string;
  meta?: string;
  value: string;
}

function messageText(row: { text?: string; content?: string; name?: string; context?: string }): string {
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  if (typeof row.context === "string") return row.context;
  if (typeof row.name === "string") return row.name;
  return "";
}

function normalizeMessages(rows: SessionPayload["messages"]): ChatMessage[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row, index) => {
      const role: ChatRole = row.role === "user" || row.role === "assistant" || row.role === "tool"
        ? row.role
        : "system";
      const text = messageText(row).trim();
      if (!text) return [];
      const message: ChatMessage = {
        id: `history-${index}-${role}`,
        role,
        text,
      };
      return [message];
    });
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function PromptSpinner({ show }: { show: boolean }) {
  return show ? <Loader2 className="h-4 w-4 animate-spin" /> : null;
}

function TypingIndicator({ label = "Hermes is working" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-midground" aria-live="polite">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="hermes-typing-dot" />
        <span className="hermes-typing-dot [animation-delay:140ms]" />
        <span className="hermes-typing-dot [animation-delay:280ms]" />
      </span>
      {label ? <span className="text-xs text-text-secondary">{label}</span> : null}
    </div>
  );
}

function activityIcon(card: AgentActivity) {
  if (card.state === "complete") return <Check className="h-3.5 w-3.5" />;
  if (card.state === "failed" || card.kind === "error") return <AlertCircle className="h-3.5 w-3.5" />;
  if (card.kind === "decision") return <Lock className="h-3.5 w-3.5" />;
  if (card.kind === "tool") return <Wrench className="h-3.5 w-3.5" />;
  if (card.kind === "subagent") return <Bot className="h-3.5 w-3.5" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
}

function activityStateLabel(state: AgentActivity["state"]): string {
  if (state === "blocked") return "Needs you";
  if (state === "complete") return "Done";
  if (state === "failed") return "Issue";
  if (state === "interrupted") return "Stopped";
  if (state === "pending") return "Queued";
  return "Working";
}

function MobileAgentActivityCard({ cards }: { cards: AgentActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const primary = [...cards].reverse().find((card) => card.state === "running" || card.state === "blocked") ?? cards[cards.length - 1];
  if (!primary) {
    return (
      <div className="hermes-mobile-typing-inline">
        <TypingIndicator label="" />
      </div>
    );
  }

  const rows = [
    primary,
    ...cards
      .filter((card) => card.id !== primary.id)
      .slice(-5)
      .reverse(),
  ];

  return (
    <div className="hermes-mobile-typing-inline">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="hermes-ios-tap -mx-1 flex min-h-8 w-[calc(100%+0.5rem)] items-center justify-between gap-3 rounded-full px-1 text-left"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide activity details" : "Show activity details"}
      >
        <TypingIndicator label="" />
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-secondary transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="hermes-mobile-agent-details mt-3 space-y-2 border-t border-midground/10 pt-3">
          {rows.map((row) => (
            <div key={row.id} className="flex gap-2.5 text-left">
              <span
                className={cn(
                  "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                  row.state === "complete"
                    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                    : row.state === "blocked"
                      ? "border-warning/30 bg-warning/12 text-warning"
                      : row.state === "failed"
                        ? "border-destructive/30 bg-destructive/12 text-destructive"
                        : "border-midground/15 bg-midground/[0.055] text-text-secondary",
                )}
              >
                {activityIcon(row)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-medium leading-5 text-midground">{row.title}</span>
                  <span className="shrink-0 text-[0.62rem] leading-5 text-text-secondary">
                    {activityStateLabel(row.state)}
                  </span>
                </span>
                {row.summary && (
                  <span className="block text-[0.72rem] leading-5 text-text-secondary">{row.summary}</span>
                )}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTechnicalOpen((open) => !open)}
            className="hermes-ios-tap mt-1 min-h-9 rounded-full px-1 text-[0.72rem] font-medium text-text-secondary hover:text-midground"
          >
            {technicalOpen ? "Hide technical details" : "Show technical details"}
          </button>
          {technicalOpen && (
            <div className="rounded-[0.85rem] border border-midground/10 bg-midground/[0.035] px-3 py-2 font-mono-ui text-[0.68rem] leading-5 text-text-secondary">
              <div>event: {primary.rawType}</div>
              <div>state: {primary.state}</div>
              {primary.metrics?.durationMs ? <div>duration: {Math.round(primary.metrics.durationMs / 100) / 10}s</div> : null}
              {primary.detail ? <div className="mt-1 whitespace-pre-wrap break-words">{primary.detail}</div> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function normalizeEffort(value?: string): ReasoningEffort {
  const clean = (value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (clean === "fast" || clean === "min") return "minimal";
  if (clean === "max" || clean === "very_high" || clean === "x_high") return "xhigh";
  return REASONING_EFFORTS.some((option) => option.value === clean) ? (clean as ReasoningEffort) : "high";
}

function splitModelParts(model?: string): ModelParts {
  const clean = (model || "").split("/").pop()?.trim() || "model";
  const gpt = clean.match(/^(gpt)[-_]?(.+)$/i);
  if (gpt) return { family: gpt[1].toLowerCase(), version: gpt[2] };
  const firstBreak = clean.match(/^([a-z]+)[-_:/]?(.+)$/i);
  if (!firstBreak) return { family: clean, version: "default" };
  return {
    family: firstBreak[1].toLowerCase(),
    version: firstBreak[2] || "default",
  };
}

function modelLabel(model: string): string {
  const parts = splitModelParts(model);
  return parts.version === "default" ? parts.family : `${parts.family} · ${parts.version}`;
}

function providerLabel(provider: ModelOptionProvider): string {
  return provider.name || provider.slug;
}

function modelSwitchValue(selection: ModelSelection): string {
  return `${selection.model} --provider ${selection.provider}`;
}

function configWithReasoningEffort(config: Record<string, unknown>, effort: ReasoningEffort): Record<string, unknown> {
  const agent = config.agent && typeof config.agent === "object" && !Array.isArray(config.agent)
    ? { ...(config.agent as Record<string, unknown>) }
    : {};
  return {
    ...config,
    agent: {
      ...agent,
      reasoning_effort: effort,
    },
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function appendDraftLine(current: string, addition: string): string {
  const clean = addition.trim();
  if (!clean) return current;
  const base = current.trimEnd();
  return base ? `${base}\n${clean}` : clean;
}

function removeDraftAttachmentLine(draft: string, attachmentText: string): string {
  const target = attachmentText.trim();
  return draft
    .split("\n")
    .filter((line) => line.trim() !== target)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function defaultContextWindow(model?: string): number | null {
  const cleanModel = (model || "").toLowerCase();
  if (cleanModel.includes("gpt-5.5") || cleanModel.includes("gpt_5.5")) return 272_000;
  if (cleanModel.includes("gpt-5")) return 272_000;
  return null;
}

function estimatedMessageTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, message) => sum + message.text.length, 0);
  return Math.ceil(chars / 4);
}

function contextFillPercent(info: NonNullable<SessionPayload["info"]>, messages: ChatMessage[]): number | null {
  const usage = info.usage;
  if (Number.isFinite(usage?.context_percent)) {
    return clampPercent(Number(usage?.context_percent));
  }

  const used = Number(usage?.context_used ?? usage?.total ?? estimatedMessageTokens(messages));
  const max = Number(usage?.context_max ?? defaultContextWindow(info.model));
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return null;
  return clampPercent((used / max) * 100);
}

function isTailscaleIp(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isPrivateIp(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return parts[0] === 192 && parts[1] === 168;
}

function currentSecurityStats(connection: ConnectionState) {
  const location =
    typeof window === "undefined"
      ? { hostname: "", origin: "Current app", protocol: "" }
      : window.location;
  const hostname = location.hostname;
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isTailnet = hostname.endsWith(".ts.net") || isTailscaleIp(hostname);
  const isPrivate = isLoopback || isTailnet || isPrivateIp(hostname);
  const hasSessionToken = typeof window !== "undefined" && Boolean(window.__HERMES_SESSION_TOKEN__);

  if (isLoopback) {
    return {
      exposure: "No public origin detected",
      exposureDetail: "This preview is on loopback, so it is visible only to this device.",
      exposureTone: "safe" as const,
      scope: "This device",
      origin: location.origin,
      auth: hasSessionToken ? "Dashboard session token present" : "Loopback preview session",
      transport: connection === "open" ? "Gateway connected" : "Gateway reconnecting",
    };
  }

  if (isTailnet) {
    return {
      exposure: "Tailscale-looking origin",
      exposureDetail: "This host looks scoped to Tailscale devices. Verify Serve still reports tailnet-only before treating it as private.",
      exposureTone: "safe" as const,
      scope: "Tailnet devices",
      origin: location.origin,
      auth: hasSessionToken ? "Dashboard session token present" : "Session token not visible",
      transport: connection === "open" ? "Gateway connected" : "Gateway reconnecting",
    };
  }

  if (isPrivate) {
    return {
      exposure: "Private network origin",
      exposureDetail: "This is not a public-looking host, but it may be reachable from the local network.",
      exposureTone: "review" as const,
      scope: "Private LAN",
      origin: location.origin,
      auth: hasSessionToken ? "Dashboard session token present" : "Session token not visible",
      transport: connection === "open" ? "Gateway connected" : "Gateway reconnecting",
    };
  }

  return {
    exposure: "Review exposure",
    exposureDetail: "This origin does not look like loopback or Tailscale from the browser.",
    exposureTone: "alert" as const,
    scope: "Public-looking host",
    origin: location.origin,
    auth: hasSessionToken ? "Dashboard session token present" : "Session token not visible",
    transport: connection === "open" ? "Gateway connected" : "Gateway reconnecting",
  };
}

function SecurityStatsSheet({
  connection,
  onClose,
}: {
  connection: ConnectionState;
  onClose: () => void;
}) {
  const stats = currentSecurityStats(connection);
  const isSafe = stats.exposureTone === "safe";

  return (
    <div className="hermes-security-backdrop absolute inset-0 z-30 flex items-start justify-center px-3 pt-20">
      <div className="hermes-security-sheet hermes-ios-surface w-full max-w-sm overflow-hidden rounded-[1.55rem] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "grid h-11 w-11 place-items-center rounded-full border shadow-[0_0_24px_rgba(45,212,191,0.24)]",
                isSafe
                  ? "border-emerald-300/35 bg-emerald-300/12 text-emerald-100"
                  : "border-warning/35 bg-warning/12 text-warning",
              )}
            >
              {isSafe ? <ShieldCheck className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-midground">Security & privacy</p>
              <p className="text-xs text-text-secondary">{stats.exposure}</p>
            </div>
          </div>
          <Button
            ghost
            size="icon"
            type="button"
            aria-label="Close security stats"
            onClick={onClose}
            className="hermes-ios-tap h-10 w-10 rounded-full border border-current/10 text-text-secondary hover:bg-current/10"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="hermes-security-info-block mt-4 rounded-[1.15rem] border border-current/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-[0.12em] text-text-secondary">Outside tailnet</span>
            <span
              className={cn(
                "rounded-full px-2 py-1 text-[0.65rem] font-semibold",
                isSafe ? "bg-emerald-300/14 text-emerald-100" : "bg-warning/14 text-warning",
              )}
            >
              {isSafe ? "Not detected" : "Review"}
            </span>
          </div>
          <p className="text-sm leading-5 text-foreground">{stats.exposureDetail}</p>
        </div>

        <div className="mt-3 grid gap-2 text-sm">
          {[
            ["Access scope", stats.scope],
            ["Current origin", stats.origin],
            ["Auth gate", stats.auth],
            ["Live channel", stats.transport],
          ].map(([label, value]) => (
            <div key={label} className="hermes-security-stat-row flex items-start justify-between gap-3 rounded-2xl border border-current/8 px-3 py-2.5">
              <span className="shrink-0 text-xs text-text-secondary">{label}</span>
              <span className="min-w-0 max-w-[62%] break-words text-right text-xs leading-4 text-midground">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IOSPickerField({
  disabled,
  label,
  onOpenChange,
  onSelect,
  open,
  options,
  placeholder,
  value,
  valueLabel,
}: {
  disabled?: boolean;
  label: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
  open: boolean;
  options: ModelPickerOption[];
  placeholder: string;
  value: string;
  valueLabel: string;
}) {
  return (
    <div className="relative grid gap-1.5 text-xs text-text-secondary">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="hermes-ios-tap flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-current/10 bg-background-base/45 px-3 text-left text-sm text-midground outline-none hover:bg-midground/8 disabled:opacity-55"
      >
        <span className="min-w-0 truncate">{valueLabel || placeholder}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="hermes-ios-picker-list hermes-ios-surface hermes-session-menu absolute left-0 right-0 top-[calc(100%+0.45rem)] z-[60] max-h-64 overflow-y-auto rounded-[1.15rem] p-1.5 shadow-[0_18px_52px_rgba(0,0,0,0.46)]"
        >
          {options.length === 0 ? (
            <div className="px-3 py-3 text-sm text-text-secondary">{placeholder}</div>
          ) : (
            <>
              <div className="mb-1 flex min-h-11 items-center gap-3 rounded-[0.95rem] border border-emerald-200/20 bg-emerald-300/10 px-3 py-2 text-emerald-50">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-current/15 bg-current/8">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold leading-5">{valueLabel}</span>
                  <span className="block truncate text-[0.68rem] leading-4 text-text-secondary">Current</span>
                </span>
              </div>
              {options.map((item) => {
                const selected = item.value === value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      navigator.vibrate?.(4);
                      onSelect(item.value);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "hermes-ios-tap flex min-h-11 w-full items-center gap-3 rounded-[0.95rem] px-3 py-2 text-left transition-colors",
                      selected
                        ? "bg-midground/14 text-midground"
                        : "text-text-secondary hover:bg-midground/8 hover:text-midground",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-current/12 bg-current/6",
                        selected ? "text-emerald-100" : "text-transparent",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-5">{item.label}</span>
                      {item.meta && (
                        <span className="block truncate text-[0.68rem] leading-4 text-text-secondary">
                          {item.meta}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModelChangerSheet({
  currentEffort,
  currentModel,
  currentProvider,
  onApply,
  onClose,
  running,
}: {
  currentEffort?: string;
  currentModel?: string;
  currentProvider?: string;
  onApply: (selection: ModelSelection & { confirmExpensiveModel?: boolean }) => Promise<ModelApplyResult>;
  onClose: () => void;
  running: boolean;
}) {
  const [options, setOptions] = useState<ModelOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState(currentProvider || "");
  const [model, setModel] = useState(currentModel || "");
  const [effort, setEffort] = useState<ReasoningEffort>(normalizeEffort(currentEffort));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<ModelPickerName | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getModelOptions()
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = options?.providers ?? [];
  const selectedProvider = provider || currentProvider || options?.provider || providers[0]?.slug || "";
  const selectedProviderRow = providers.find((item) => item.slug === selectedProvider);
  const providerRow = selectedProviderRow ?? providers[0];
  const providerModels = providerRow?.models ?? [];
  const selectedModel = model || currentModel || options?.model || providerModels[0] || "";
  const selectedParts = splitModelParts(selectedModel);
  const familyOptions = Array.from(new Set(providerModels.map((item) => splitModelParts(item).family)));
  const versionOptions = providerModels.filter((item) => splitModelParts(item).family === selectedParts.family);
  const selectedProviderFallback = selectedProvider && !selectedProviderRow
    ? [{ label: selectedProvider, meta: "Current provider", value: selectedProvider }]
    : [];
  const providerPickerOptions = [
    ...selectedProviderFallback,
    ...providers.map((item) => {
      const modelCount = item.models?.length ?? 0;
      return {
        label: providerLabel(item),
        meta: modelCount > 0 ? `${modelCount} models` : undefined,
        value: item.slug,
      };
    }),
  ];
  const familyPickerOptions = familyOptions.map((family) => ({
    label: family,
    meta: `${providerRow ? providerLabel(providerRow) : "Host"} model family`,
    value: family,
  }));
  const versionPickerOptions = versionOptions.map((item) => ({
    label: splitModelParts(item).version,
    meta: modelLabel(item),
    value: item,
  }));

  const chooseProvider = (nextProvider: string) => {
    const nextRow = providers.find((item) => item.slug === nextProvider);
    const nextModels = nextRow?.models ?? [];
    const sameFamily = nextModels.find((item) => splitModelParts(item).family === selectedParts.family);
    setProvider(nextProvider);
    setModel(sameFamily || nextModels[0] || "");
  };

  const chooseFamily = (family: string) => {
    const next = providerModels.find((item) => splitModelParts(item).family === family);
    if (next) setModel(next);
  };

  const submit = async (confirmExpensiveModel = false) => {
    if (!selectedProvider || !selectedModel) {
      setError("Choose a provider and model first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onApply({
        confirmExpensiveModel,
        effort,
        model: selectedModel,
        provider: selectedProvider,
      });
      if (result.confirm_required) {
        setPendingConfirm(result.confirm_message || "This model may have unusually high pricing.");
        return;
      }
      navigator.vibrate?.(8);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-3 top-[calc(0.9rem+env(safe-area-inset-top,0px))] bottom-[calc(5.65rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center">
      <div className="hermes-model-card hermes-ios-surface hermes-mythic-frame pointer-events-auto relative flex min-h-0 w-full max-w-md flex-col overflow-visible rounded-[1.65rem] shadow-[0_22px_70px_rgba(0,0,0,0.5)]">
        <span aria-hidden="true" className="hermes-mythic-art hermes-mythic-art--menu" />
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-current/20 px-4">
          <div
            className="font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground uppercase"
            style={{ mixBlendMode: "plus-lighter" }}
          >
            Model
          </div>
          <Button
            ghost
            size="icon"
            type="button"
            aria-label="Close model changer"
            onClick={onClose}
            className="hermes-ios-tap h-11 w-11 rounded-full text-text-secondary hover:bg-midground/10 hover:text-midground"
          >
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-[0.72rem] leading-4 text-text-secondary">
            {selectedModel ? modelLabel(selectedModel) : "Loading host models"}
          </p>

        <div className="grid gap-2.5">
          <IOSPickerField
            disabled={loading || busy || providers.length === 0}
            label="Provider"
            onOpenChange={(open) => setOpenPicker(open ? "provider" : null)}
            onSelect={chooseProvider}
            open={openPicker === "provider"}
            options={providerPickerOptions}
            placeholder="No providers"
            value={selectedProvider}
            valueLabel={selectedProviderRow ? providerLabel(selectedProviderRow) : selectedProvider}
          />

          <IOSPickerField
            disabled={loading || busy || familyOptions.length === 0}
            label="Model"
            onOpenChange={(open) => setOpenPicker(open ? "family" : null)}
            onSelect={chooseFamily}
            open={openPicker === "family"}
            options={familyPickerOptions}
            placeholder="No models"
            value={selectedParts.family}
            valueLabel={selectedParts.family}
          />

          <IOSPickerField
            disabled={loading || busy || versionOptions.length === 0}
            label="Version"
            onOpenChange={(open) => setOpenPicker(open ? "version" : null)}
            onSelect={setModel}
            open={openPicker === "version"}
            options={versionPickerOptions}
            placeholder="No versions"
            value={selectedModel}
            valueLabel={selectedParts.version}
          />

          <div className="grid gap-1.5 text-xs text-text-secondary">
            Effort
            <div className="hermes-effort-strip flex gap-1 overflow-x-auto rounded-2xl border border-current/10 bg-background-base/28 p-1">
              {REASONING_EFFORTS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setEffort(item.value)}
                  className={cn(
                    "hermes-ios-tap flex min-h-11 min-w-[4.7rem] flex-col items-center justify-center rounded-[0.95rem] px-2 text-xs font-semibold",
                    effort === item.value
                      ? "bg-midground text-background-base shadow-[0_8px_24px_rgba(255,230,203,0.16)]"
                      : "text-text-secondary hover:bg-current/8 hover:text-midground",
                  )}
                >
                  <span>{item.label}</span>
                  {item.caption && (
                    <span className={cn(
                      "mt-0.5 text-[0.62rem] font-normal leading-none",
                      effort === item.value ? "text-background-base/65" : "text-text-secondary",
                    )}
                    >
                      {item.caption}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {pendingConfirm && (
          <div className="mt-3 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-xs leading-5 text-warning">
            {pendingConfirm}
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                ghost
                onClick={() => setPendingConfirm(null)}
                className="hermes-ios-tap min-h-10 flex-1 rounded-xl border border-current/15 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submit(true)}
                disabled={busy || running}
                className="hermes-ios-tap min-h-10 flex-1 rounded-xl text-xs"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-2xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
            {error}
          </div>
        )}

        <Button
          type="button"
          onClick={() => void submit(false)}
          disabled={busy || loading || running || !selectedProvider || !selectedModel}
          className="hermes-ios-tap mt-3 min-h-11 w-full rounded-2xl text-sm font-semibold"
          prefix={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        >
          {running ? "Wait for turn" : "Apply"}
        </Button>
        </div>
      </div>
    </div>
  );
}

function needsInputKey(needsInput: NeedsInput): string {
  if (needsInput.kind === "approval") return `approval-${needsInput.sessionId ?? ""}-${needsInput.command}-${needsInput.description}`;
  if (needsInput.kind === "clarify") return `clarify-${needsInput.requestId}`;
  if (needsInput.kind === "sudo") return `sudo-${needsInput.requestId}`;
  return `secret-${needsInput.requestId}`;
}

function needsInputSummary(needsInput: NeedsInput | null): string {
  if (!needsInput) return "No decisions are waiting right now.";
  if (needsInput.kind === "approval") return needsInput.description || "Hermes needs approval to continue.";
  if (needsInput.kind === "clarify") return needsInput.question || "Hermes needs an answer.";
  if (needsInput.kind === "sudo") return "Hermes needs a sudo password for one request.";
  return needsInput.prompt || `Hermes needs ${needsInput.envVar || "a secret"}.`;
}

function needsInputTitle(needsInput: NeedsInput | null): string {
  if (!needsInput) return "All clear";
  if (needsInput.kind === "approval") return "Approve an action";
  if (needsInput.kind === "clarify") return "Answer a question";
  if (needsInput.kind === "sudo") return "Enter sudo password";
  return `Enter ${needsInput.envVar || "secret"}`;
}

function needsInputPlainLanguage(needsInput: NeedsInput): string {
  if (needsInput.kind === "approval") {
    return "Hermes wants permission to take one action. Review what it is trying to do, then choose whether to allow it once or deny it.";
  }
  if (needsInput.kind === "clarify") {
    return "Hermes needs a little more direction before it can continue. Pick one of the suggested answers or write your own.";
  }
  if (needsInput.kind === "sudo") {
    return "Hermes is waiting for your sudo password to finish this one local command. The password is only used for this request.";
  }
  return "Hermes is waiting for a private value so it can continue this request. Enter it here when you are ready.";
}

function NeedsInputGlyph({ needsInput }: { needsInput: NeedsInput | null }) {
  if (!needsInput) return <Check className="h-4 w-4" />;
  if (needsInput.kind === "approval") return <TerminalSquare className="h-4 w-4" />;
  if (needsInput.kind === "clarify") return <HelpCircle className="h-4 w-4" />;
  if (needsInput.kind === "sudo") return <Lock className="h-4 w-4" />;
  return <KeyRound className="h-4 w-4" />;
}

function approvalTarget(needsInput: Extract<NeedsInput, { kind: "approval" }>): string {
  const command = needsInput.command || needsInput.description;
  const cwd = command.match(/(?:cd|--cwd|cwd=)\s+([^\s;&]+)/i)?.[1];
  if (cwd) return cwd.replace(/^["']|["']$/g, "");
  if (/photos?|image|folder|file|directory/i.test(command)) return "Files on this device";
  if (/npm|node|vite|build|test|eslint/i.test(command)) return "Local development workspace";
  if (/ssh|scp|rsync|tailscale|network|host/i.test(command)) return "Private tailnet resource";
  return "This Hermes session";
}

function publishMobileAttention(needsInput: NeedsInput | null) {
  if (typeof window === "undefined") return;
  const count = needsInput ? 1 : 0;
  window.dispatchEvent(new CustomEvent("hermes-mobile-attention", {
    detail: {
      approvals: needsInput?.kind === "approval" ? 1 : 0,
      count,
      needsInput: count,
    },
  }));
}

function DecisionCenterSheet({
  draft,
  needsInput,
  notificationPermission,
  onApproval,
  onClarify,
  onClose,
  onDraftChange,
  onRequestNotifications,
  onSecureSubmit,
  open,
  presentation = "sheet",
  submitting,
}: {
  draft: string;
  needsInput: NeedsInput | null;
  notificationPermission: NotificationPermission | "unsupported";
  onApproval: (choice: ApprovalChoice) => Promise<void>;
  onClarify: (answer: string) => Promise<void>;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onRequestNotifications: () => Promise<void>;
  onSecureSubmit: (value: string) => Promise<void>;
  open: boolean;
  presentation?: "pane" | "sheet";
  submitting: null | string;
}) {
  if (!open) return null;

  const busy = submitting !== null;
  const secure = needsInput?.kind === "sudo" || needsInput?.kind === "secret";
  const alertsEnabled = notificationPermission === "granted";
  const pane = presentation === "pane";

  const submitSecure = () => {
    if (!secure) return;
    void onSecureSubmit(draft);
  };

  return (
    <div
      className={cn(
        pane
          ? "flex min-h-0 flex-1"
          : "pointer-events-none absolute inset-x-3 bottom-[calc(5.65rem+env(safe-area-inset-bottom,0px))] z-30 flex justify-center",
      )}
    >
      <div
        className={cn(
          "hermes-decision-card pointer-events-auto w-full overflow-y-auto",
          pane
            ? "min-h-0 flex-1 px-5 py-4"
            : "hermes-ios-surface max-h-[min(28rem,calc(100dvh-15rem))] rounded-[1.6rem] p-4",
        )}
      >
        {!pane && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-warning">
                <Bell className="h-3.5 w-3.5" />
                Needs input
              </div>
              <Typography className="mt-2 text-[1.35rem] font-semibold leading-tight text-midground">
                Decision center
              </Typography>
            </div>
            <Button
              ghost
              size="icon"
              onClick={onClose}
              aria-label="Close decision center"
              className="hermes-ios-tap h-11 w-11 rounded-full border border-current/15 text-text-secondary hover:bg-midground/10 hover:text-midground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className={cn("grid gap-3", pane ? "mt-0" : "mt-4")}>
          {needsInput ? (
            <details className="group rounded-[1.2rem] border border-warning/24 bg-warning/[0.075] shadow-[0_18px_44px_rgba(0,0,0,0.18)] backdrop-blur-xl">
              <summary className="hermes-ios-tap flex min-h-[5.25rem] cursor-pointer list-none items-center gap-3 px-3.5 py-3 text-left [&::-webkit-details-marker]:hidden">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-warning/24 bg-warning/10 text-warning shadow-[0_0_18px_rgba(255,189,56,0.18)]">
                  <NeedsInputGlyph needsInput={needsInput} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[0.66rem] uppercase tracking-[0.14em] text-warning">
                    <Hourglass className="h-3.5 w-3.5" />
                    Needs your attention
                  </span>
                  <span className="mt-1 block text-[1.02rem] font-semibold leading-5 text-midground">
                    {needsInputTitle(needsInput)}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-text-secondary">
                    {needsInputSummary(needsInput)}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary transition-transform group-open:rotate-180" />
              </summary>

              <div className="space-y-3 border-t border-warning/16 px-3.5 pb-3 pt-3">
                <p className="rounded-[1rem] border border-midground/12 bg-background-base/28 px-3 py-2.5 text-sm leading-6 text-midground">
                  {needsInputPlainLanguage(needsInput)}
                </p>

                {needsInput.kind === "approval" && (
                  <div className="space-y-3">
                    <div className="grid gap-2 text-xs text-text-secondary">
                      <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-midground/12 bg-black/18 px-3">
                        <ShieldCheck className="h-4 w-4 text-emerald-200" />
                        <span className="min-w-0 flex-1">Target</span>
                        <span className="max-w-[55%] truncate text-midground">{approvalTarget(needsInput)}</span>
                      </div>
                      <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-midground/12 bg-black/18 px-3">
                        <FileText className="h-4 w-4 text-warning" />
                        <span className="min-w-0 flex-1">Scope</span>
                        <span className="text-midground">One action</span>
                      </div>
                    </div>
                    {needsInput.command && (
                      <pre className="max-h-32 overflow-auto rounded-2xl border border-warning/20 bg-black/30 p-3 text-xs leading-5 text-midground">
                        <code>{needsInput.command}</code>
                      </pre>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApproval("deny")}
                        className="hermes-ios-tap h-11 rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
                      >
                        <PromptSpinner show={submitting === "deny"} />
                        Deny
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApproval("once")}
                        className="hermes-ios-tap h-11 rounded-2xl border border-midground/25 bg-midground text-background-base"
                      >
                        <PromptSpinner show={submitting === "once"} />
                        Approve once
                      </Button>
                    </div>
                  </div>
                )}

                {needsInput.kind === "clarify" && (
                  <div className="space-y-3">
                    {needsInput.choices.length > 0 && (
                      <div className="grid gap-2">
                        {needsInput.choices.map((choice) => (
                          <Button
                            key={choice}
                            type="button"
                            disabled={busy}
                            onClick={() => void onClarify(choice)}
                            className="hermes-ios-tap min-h-11 justify-start rounded-2xl border border-midground/15 bg-midground/8 px-3 text-left text-sm text-midground hover:bg-midground/14"
                          >
                            <Check className="h-4 w-4" />
                            <span className="whitespace-normal leading-5">{choice}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                    <form
                      className="flex items-end gap-2 rounded-[1.25rem] border border-midground/15 bg-black/20 p-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (draft.trim()) void onClarify(draft.trim());
                      }}
                    >
                      <textarea
                        value={draft}
                        onChange={(event) => onDraftChange(event.target.value)}
                        rows={2}
                        placeholder="Type your decision"
                        disabled={busy}
                        className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 text-midground outline-none placeholder:text-text-secondary/65"
                      />
                      <Button
                        type="submit"
                        disabled={busy || !draft.trim()}
                        className="hermes-ios-tap h-11 rounded-full border border-midground/25 bg-midground px-4 text-background-base disabled:opacity-40"
                      >
                        Send
                      </Button>
                    </form>
                  </div>
                )}

                {secure && (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitSecure();
                    }}
                  >
                    <input
                      autoComplete="off"
                      disabled={busy}
                      onChange={(event) => onDraftChange(event.target.value)}
                      placeholder={needsInput.kind === "sudo" ? "Password" : needsInput.envVar || "Secret value"}
                      spellCheck={false}
                      type="password"
                      value={draft}
                      className="h-12 w-full rounded-2xl border border-midground/15 bg-black/25 px-3 text-base text-midground outline-none placeholder:text-text-secondary/65 focus:border-midground/35"
                    />
                    <Button
                      type="submit"
                      disabled={busy || !draft}
                      className="hermes-ios-tap h-11 w-full rounded-2xl border border-midground/25 bg-midground text-background-base disabled:opacity-40"
                    >
                      Send secure response
                    </Button>
                  </form>
                )}
              </div>
            </details>
          ) : (
            <article className="rounded-[1.2rem] border border-emerald-200/18 bg-emerald-300/[0.075] p-3.5 shadow-[0_18px_44px_rgba(0,0,0,0.14)] backdrop-blur-xl">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-emerald-200/20 bg-emerald-300/10 text-emerald-100">
                  <Check className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[0.66rem] uppercase tracking-[0.14em] text-emerald-100">
                    Clear
                  </span>
                  <span className="mt-1 block text-[1.02rem] font-semibold leading-5 text-midground">
                    No decisions are waiting right now.
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-text-secondary">
                    Approval requests, questions, passwords, and secrets will appear here as tappable cards.
                  </span>
                </span>
              </div>
            </article>
          )}

        <article className="rounded-[1.2rem] border border-midground/14 bg-background-base/24 p-3.5 shadow-[0_18px_44px_rgba(0,0,0,0.12)] backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-midground/15 bg-black/15 text-midground">
              <Bell className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-midground">
                {alertsEnabled ? "Alerts enabled" : "Pocket alerts"}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-secondary">
                {alertsEnabled
                  ? "Hermes will show a local notification when this page receives a decision request while hidden."
                  : "Enable browser alerts so hidden-tab decision requests can notify you."}
              </p>
            </div>
          </div>
          {!alertsEnabled && (
            <Button
              type="button"
              onClick={() => void onRequestNotifications()}
              disabled={notificationPermission === "unsupported" || notificationPermission === "denied"}
              className="hermes-ios-tap mt-3 h-11 w-full rounded-2xl border border-midground/20 bg-midground/10 font-sans text-sm normal-case tracking-normal text-midground disabled:opacity-45"
            >
              {notificationPermission === "denied"
                ? "Alerts blocked in browser"
                : notificationPermission === "unsupported"
                  ? "Alerts unavailable"
                  : "Enable alerts"}
            </Button>
          )}
        </article>
        </div>
      </div>
    </div>
  );
}

function NeedsInputSheet({
  draft,
  needsInput,
  onApproval,
  onCancelSecure,
  onClarify,
  onDraftChange,
  onSecureSubmit,
  submitting,
}: {
  draft: string;
  needsInput: NeedsInput;
  onApproval: (choice: ApprovalChoice) => Promise<void>;
  onCancelSecure: () => Promise<void>;
  onClarify: (answer: string) => Promise<void>;
  onDraftChange: (value: string) => void;
  onSecureSubmit: (value: string) => Promise<void>;
  submitting: null | string;
}) {
  const busy = submitting !== null;
  const secure = needsInput.kind === "sudo" || needsInput.kind === "secret";
  const title =
    needsInput.kind === "clarify"
      ? "Hermes needs an answer"
      : needsInput.kind === "approval"
        ? "Approval needed"
        : needsInput.kind === "sudo"
          ? "Sudo password"
          : needsInput.envVar || "Secret needed";
  const Icon =
    needsInput.kind === "clarify"
      ? HelpCircle
      : needsInput.kind === "approval"
        ? TerminalSquare
        : needsInput.kind === "sudo"
          ? Lock
          : KeyRound;

  const submitText = () => {
    const value = draft.trim();
    if (needsInput.kind === "clarify") {
      if (value) void onClarify(value);
      return;
    }
    if (secure) {
      void onSecureSubmit(draft);
    }
  };

  return (
    <div className="absolute inset-x-2 bottom-[calc(5.95rem+env(safe-area-inset-bottom,0px))] z-20 px-1">
      <div className="hermes-ios-surface hermes-mobile-card rounded-[1.55rem] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-midground/15 bg-midground/10 text-midground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.15em] text-warning">
              <span className="h-2 w-2 rounded-full bg-warning shadow-[0_0_16px_rgba(255,189,56,0.65)]" />
              Needs input
            </div>
            <Typography className="mt-1 text-[1.02rem] font-semibold leading-tight text-midground">
              {title}
            </Typography>
          </div>
        </div>

        {needsInput.kind === "approval" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-[1.1rem] border border-warning/20 bg-warning/8 p-3">
              <div className="mb-2 flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.14em] text-warning">
                <Hourglass className="h-3.5 w-3.5" />
                Awaiting approval
              </div>
              <p className="text-sm leading-6 text-midground">{needsInput.description}</p>
            </div>
            <div className="grid gap-2 text-xs text-text-secondary">
              <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-midground/12 bg-black/18 px-3">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                <span className="min-w-0 flex-1">Target resource</span>
                <span className="max-w-[52%] truncate text-midground">{approvalTarget(needsInput)}</span>
              </div>
              <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-midground/12 bg-black/18 px-3">
                <FileText className="h-4 w-4 text-warning" />
                <span className="min-w-0 flex-1">Access scope</span>
                <span className="text-midground">One action only</span>
              </div>
            </div>
            {needsInput.command && (
              <pre className="max-h-36 overflow-auto rounded-2xl border border-warning/20 bg-black/30 p-3 text-xs leading-5 text-midground">
                <code>{needsInput.command}</code>
              </pre>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onApproval("deny")}
                className="hermes-ios-tap h-11 rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
              >
                <PromptSpinner show={submitting === "deny"} />
                Deny
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onApproval("once")}
                className="hermes-ios-tap h-11 rounded-2xl border border-midground/25 bg-midground text-background-base"
              >
                <PromptSpinner show={submitting === "once"} />
                Approve once
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Approve similar actions for this whole session?")) return;
                  void onApproval("session");
                }}
                className="hermes-ios-tap col-span-2 h-11 rounded-2xl border border-midground/15 bg-midground/8 text-midground hover:bg-midground/15"
              >
                <PromptSpinner show={submitting === "session"} />
                Approve this session
              </Button>
              {needsInput.allowPermanent && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Permanently approve this action pattern?")) return;
                    void onApproval("always");
                  }}
                  className="hermes-ios-tap col-span-2 h-11 rounded-2xl border border-warning/25 bg-warning/12 text-warning hover:bg-warning/18"
                >
                  <PromptSpinner show={submitting === "always"} />
                  Approve always
                </Button>
              )}
            </div>
          </div>
        )}

        {needsInput.kind === "clarify" && (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-6 text-text-secondary">{needsInput.question}</p>
            {needsInput.choices.length > 0 && (
              <div className="grid gap-2">
                {needsInput.choices.map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    disabled={busy}
                    onClick={() => void onClarify(choice)}
                    className="hermes-ios-tap min-h-11 justify-start rounded-2xl border border-midground/15 bg-midground/8 px-3 text-left text-sm text-midground hover:bg-midground/14"
                  >
                    {submitting === "clarify" ? <PromptSpinner show /> : <Check className="h-4 w-4" />}
                    <span className="whitespace-normal leading-5">{choice}</span>
                  </Button>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2 rounded-[1.25rem] border border-midground/15 bg-black/20 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitText();
              }}
            >
              <textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                rows={2}
                placeholder="Type a custom answer"
                disabled={busy}
                className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 text-midground outline-none placeholder:text-text-secondary/65"
              />
              <Button
                type="submit"
                disabled={busy || !draft.trim()}
                className="hermes-ios-tap h-11 rounded-full border border-midground/25 bg-midground px-4 text-background-base disabled:opacity-40"
              >
                <PromptSpinner show={submitting === "clarify"} />
                Send
              </Button>
            </form>
          </div>
        )}

        {secure && (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitText();
            }}
          >
            <p className="text-sm leading-6 text-text-secondary">
              {needsInput.kind === "sudo"
                ? "Enter the password for this one sudo request."
                : needsInput.prompt}
            </p>
            <input
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              inputMode="text"
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={needsInput.kind === "sudo" ? "Password" : needsInput.envVar || "Secret value"}
              spellCheck={false}
              type="password"
              value={draft}
              className="h-12 w-full rounded-2xl border border-midground/15 bg-black/25 px-3 text-base text-midground outline-none placeholder:text-text-secondary/65 focus:border-midground/35"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onCancelSecure()}
                className="hermes-ios-tap h-11 rounded-2xl border border-current/15 bg-current/5 text-text-secondary hover:bg-current/10 hover:text-midground"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !draft}
                className="hermes-ios-tap h-11 rounded-2xl border border-midground/25 bg-midground text-background-base disabled:opacity-40"
              >
                <PromptSpinner show={submitting === needsInput.kind} />
                Send
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function MobileChatSurface({
  active,
  decisionPanelRequested = false,
  onDecisionPanelClose,
  profile = "",
  resume = null,
}: MobileChatSurfaceProps) {
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [forceNewForResume, setForceNewForResume] = useState<string | null>(null);
  // Version intentionally rebuilds the WebSocket client for the in-place "new chat"
  // action without remounting the whole dashboard route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gateway = useMemo(() => new GatewayClient(), [version]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityModel, setActivityModel] = useState(() => emptyActivityModel());
  const [info, setInfo] = useState<NonNullable<SessionPayload["info"]>>({});
  const [needsInput, setNeedsInput] = useState<NeedsInput | null>(null);
  const [inputDraft, setInputDraft] = useState("");
  const [submittingInput, setSubmittingInput] = useState<null | string>(null);
  const [attachingFiles, setAttachingFiles] = useState(false);
  const contextPercent = useMemo(() => contextFillPercent(info, messages), [info, messages]);
  const contextRingPercent = Math.min(100, Math.max(0, contextPercent ?? 0));
  const contextRingStyle: CSSProperties & { "--hermes-context-ring": string } = {
    "--hermes-context-ring": `conic-gradient(from -90deg, rgba(255,255,255,0.98) ${contextRingPercent}%, transparent 0)`,
  };
  const [securityOpen, setSecurityOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const decisionPanelOpen = decisionPanelRequested;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastNotificationRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(86);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const hasVisibleTypingBubble = messages.some(
    (message) => message.role === "assistant" && Boolean(message.streaming),
  );
  const visibleActivityCards = useMemo(() => getVisibleActivityCards(activityModel), [activityModel]);
  const shieldDisconnected = connection === "closed" || connection === "error";
  const shieldStatusClass = shieldDisconnected
    ? "text-destructive"
    : connection !== "open" || error
      ? "text-warning"
      : "text-emerald-300";
  const shieldStatusLabel = shieldDisconnected
    ? "Security status: disconnected"
    : connection !== "open" || error
      ? "Security status: attention needed"
      : "Security status: private and connected";

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const closeDecisionPanel = useCallback(() => {
    onDecisionPanelClose?.();
  }, [onDecisionPanelClose]);

  const pushActivity = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setActivityModel((prev) => applyGatewayEventToActivities(prev, {
      payload: { kind: "status", text: clean },
      session_id: sessionIdRef.current ?? undefined,
      type: "status.update",
    }));
  }, []);

  const requestNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      pushActivity("alerts unavailable");
      return;
    }
    const next = await Notification.requestPermission();
    setNotificationPermission(next);
    pushActivity(next === "granted" ? "alerts enabled" : "alerts not enabled");
  }, [pushActivity]);

  const navigateFromMenu = useCallback((path: string) => {
    setSessionMenuOpen(false);
    navigate(path);
  }, [navigate]);

  useEffect(() => {
    if (!needsInput) return;
    const key = needsInputKey(needsInput);
    if (lastNotificationRef.current === key) return;
    lastNotificationRef.current = key;
    navigator.vibrate?.([18, 40, 18]);
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      typeof document !== "undefined" &&
      document.hidden
    ) {
      new Notification("Hermes needs input", {
        body: "Open the private Hermes dashboard to review it.",
        tag: "hermes-needs-input",
      });
    }
  }, [needsInput]);

  useEffect(() => {
    publishMobileAttention(needsInput);
    return () => publishMobileAttention(null);
  }, [needsInput]);

  const ensureAssistantStreaming = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) return prev;
      return [...prev, { id: newId("assistant"), role: "assistant", text: "", streaming: true }];
    });
  }, []);

  const appendAssistantDelta = useCallback((delta: string) => {
    if (!delta) return;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        next[next.length - 1] = { ...last, text: `${last.text}${delta}` };
        return next;
      }
      return [...next, { id: newId("assistant"), role: "assistant", text: delta, streaming: true }];
    });
  }, []);

  const completeAssistant = useCallback((text: string, status?: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      const finalText = text.trim() || last?.text || "";
      if (last?.role === "assistant" && last.streaming) {
        if (!finalText.trim()) return next.slice(0, -1);
        next[next.length - 1] = {
          ...last,
          text: finalText,
          streaming: false,
        };
        return next;
      }
      if (!finalText.trim()) return next;
      return [...next, { id: newId("assistant"), role: "assistant", text: finalText }];
    });

    if (status && status !== "complete") {
      pushActivity(`turn ${status}`);
    }
  }, [pushActivity]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const offState = gateway.onState(setConnection);
    const offInfo = gateway.on<SessionPayload["info"]>("session.info", (ev) => {
      if (ev.session_id) setSessionId(ev.session_id);
      if (ev.payload) setInfo((prev) => ({ ...prev, ...ev.payload }));
    });
    const offStart = gateway.on("message.start", () => {
      setRunning(true);
      ensureAssistantStreaming();
    });
    const offDelta = gateway.on<TextPayload>("message.delta", (ev) => {
      appendAssistantDelta(ev.payload?.text ?? "");
    });
    const offComplete = gateway.on<TextPayload>("message.complete", (ev) => {
      setRunning(false);
      completeAssistant(ev.payload?.text ?? "", ev.payload?.status);
      if (ev.payload?.usage) setInfo((prev) => ({ ...prev, usage: ev.payload?.usage }));
      if (ev.payload?.warning) pushActivity(ev.payload.warning);
    });
    const offActivity = gateway.onAny((ev) => {
      setActivityModel((prev) => applyGatewayEventToActivities(prev, ev));
    });
    const offClarify = gateway.on<ClarifyPayload>("clarify.request", (ev) => {
      const requestId = ev.payload?.request_id;
      if (!requestId) return;
      setInputDraft("");
      setSubmittingInput(null);
      setNeedsInput({
        choices: Array.isArray(ev.payload?.choices) ? ev.payload.choices.filter(Boolean) : [],
        kind: "clarify",
        question: ev.payload?.question || "Hermes needs clarification.",
        requestId,
      });
      pushActivity("clarification needed");
    });
    const offApproval = gateway.on<ApprovalPayload>("approval.request", (ev) => {
      setInputDraft("");
      setSubmittingInput(null);
      setNeedsInput({
        allowPermanent: ev.payload?.allow_permanent !== false,
        command: ev.payload?.command || "",
        description: ev.payload?.description || "Hermes needs approval to continue.",
        kind: "approval",
        sessionId: ev.session_id ?? sessionIdRef.current ?? undefined,
      });
      pushActivity("approval needed");
    });
    const offSudo = gateway.on<SudoPayload>("sudo.request", (ev) => {
      const requestId = ev.payload?.request_id;
      if (!requestId) return;
      setInputDraft("");
      setSubmittingInput(null);
      setNeedsInput({ kind: "sudo", requestId });
      pushActivity("sudo password needed");
    });
    const offSecret = gateway.on<SecretPayload>("secret.request", (ev) => {
      const requestId = ev.payload?.request_id;
      if (!requestId) return;
      setInputDraft("");
      setSubmittingInput(null);
      setNeedsInput({
        envVar: ev.payload?.env_var || undefined,
        kind: "secret",
        prompt: ev.payload?.prompt || "Enter the requested secret.",
        requestId,
      });
      pushActivity("secret input needed");
    });
    const offError = gateway.on<{ message?: string }>("error", (ev: GatewayEvent<{ message?: string }>) => {
      const message = ev.payload?.message || "Hermes reported an error";
      setError(message);
      setRunning(false);
      setMessages((prev) => [
        ...prev,
        { id: newId("system"), role: "system", text: message },
      ]);
    });

    gateway
      .connect()
      .then(async () => {
        if (cancelled) return;
        const effectiveResume = forceNewForResume === (resume ?? "__new__") ? null : resume;
        const method = effectiveResume ? "session.resume" : "session.create";
        const result = await gateway.request<SessionPayload>(method, {
          ...(effectiveResume ? { session_id: effectiveResume } : {}),
          ...(profile ? { profile } : {}),
          cols: 88,
        });
        if (cancelled) return;
        setSessionId(result.session_id ?? null);
        setMessages(normalizeMessages(result.messages));
        setInfo(result.info ?? {});
        setRunning(Boolean(result.running));
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setHandoffBusy(false);
        }
      });

    return () => {
      cancelled = true;
      offState();
      offInfo();
      offStart();
      offDelta();
      offComplete();
      offActivity();
      offClarify();
      offApproval();
      offSudo();
      offSecret();
      offError();
      gateway.close();
    };
  }, [active, appendAssistantDelta, completeAssistant, ensureAssistantStreaming, forceNewForResume, gateway, profile, pushActivity, resume]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, activityModel.cards.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(160, Math.max(48, textarea.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const updateComposerHeight = () => {
      const next = Math.ceil(composer.getBoundingClientRect().height);
      setComposerHeight((current) => (Math.abs(current - next) < 1 ? current : next));
    };

    updateComposerHeight();
    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset((current) => (Math.abs(current - inset) < 1 ? current : Math.round(inset)));
    };

    updateKeyboardInset();
    viewport.addEventListener("resize", updateKeyboardInset);
    viewport.addEventListener("scroll", updateKeyboardInset);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset);
      viewport.removeEventListener("scroll", updateKeyboardInset);
    };
  }, [active]);

  const clearNeedsInput = useCallback(() => {
    setNeedsInput(null);
    setInputDraft("");
    setSubmittingInput(null);
  }, []);

  const respondClarify = useCallback(async (answer: string) => {
    if (!needsInput || needsInput.kind !== "clarify") return;
    setSubmittingInput("clarify");
    try {
      await gateway.request("clarify.respond", {
        answer,
        request_id: needsInput.requestId,
      });
      navigator.vibrate?.(8);
      pushActivity("clarification sent");
      clearNeedsInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmittingInput(null);
    }
  }, [clearNeedsInput, gateway, needsInput, pushActivity]);

  const respondApproval = useCallback(async (choice: ApprovalChoice) => {
    if (!needsInput || needsInput.kind !== "approval") return;
    const targetSessionId = needsInput.sessionId ?? sessionId;
    if (!targetSessionId) {
      setError("Cannot answer approval request without a session.");
      return;
    }
    setSubmittingInput(choice);
    try {
      await gateway.request("approval.respond", {
        choice,
        session_id: targetSessionId,
      });
      navigator.vibrate?.(choice === "deny" ? 12 : 8);
      pushActivity(choice === "deny" ? "approval denied" : `approved ${choice}`);
      clearNeedsInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmittingInput(null);
    }
  }, [clearNeedsInput, gateway, needsInput, pushActivity, sessionId]);

  const respondSecureInput = useCallback(async (value: string) => {
    if (!needsInput || (needsInput.kind !== "sudo" && needsInput.kind !== "secret")) return;
    const method = needsInput.kind === "sudo" ? "sudo.respond" : "secret.respond";
    setSubmittingInput(needsInput.kind);
    try {
      await gateway.request(method, {
        request_id: needsInput.requestId,
        ...(needsInput.kind === "sudo" ? { password: value } : { value }),
      });
      navigator.vibrate?.(8);
      pushActivity(needsInput.kind === "sudo" ? "sudo response sent" : "secret response sent");
      clearNeedsInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmittingInput(null);
      setInputDraft("");
    }
  }, [clearNeedsInput, gateway, needsInput, pushActivity]);

  const canSend = connection === "open" && Boolean(sessionId) && draft.trim().length > 0 && !running && !needsInput && !handoffBusy && !attachingFiles;

  const submit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId || running) return;

    navigator.vibrate?.(8);
    setDraft("");
    setComposerAttachments([]);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: newId("user"), role: "user", text },
    ]);
    setRunning(true);
    ensureAssistantStreaming();

    try {
      await gateway.request("prompt.submit", { session_id: sessionId, text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setRunning(false);
      setMessages((prev) => [
        ...prev,
        { id: newId("system"), role: "system", text: message },
      ]);
    }
  }, [draft, ensureAssistantStreaming, gateway, running, sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId || !running) return;
    navigator.vibrate?.(10);
    try {
      await gateway.request("session.interrupt", { session_id: sessionId });
      pushActivity("interrupted");
      setRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [gateway, pushActivity, running, sessionId]);

  const nudgeVoice = useCallback(() => {
    navigator.vibrate?.(5);
    pushActivity("voice ready");
  }, [pushActivity]);

  const openFilePicker = useCallback(() => {
    if (connection !== "open" || !sessionId || running || attachingFiles || needsInput) return;
    navigator.vibrate?.(4);
    fileInputRef.current?.click();
  }, [attachingFiles, connection, needsInput, running, sessionId]);

  const attachFiles = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (!sessionId) {
      setError("Connect to a session before attaching files.");
      return;
    }

    setAttachingFiles(true);
    setError(null);
    try {
      const additions: string[] = [];
      const chips: ComposerAttachment[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const filename = file.name || "upload";
        let result: AttachmentResult;
        let kind: ComposerAttachment["kind"] = "file";
        let text: string;
        if (file.type.startsWith("image/")) {
          kind = "image";
          result = await gateway.request<AttachmentResult>("image.attach_bytes", {
            content_base64: dataUrl,
            filename,
            session_id: sessionId,
          });
          text = result.text || `[User attached image: ${filename}]`;
        } else if (file.type === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
          kind = "pdf";
          result = await gateway.request<AttachmentResult>("pdf.attach", {
            content_base64: dataUrl,
            filename,
            session_id: sessionId,
          }, 180_000);
          text = result.text || `[User attached PDF: ${filename}]`;
        } else {
          result = await gateway.request<AttachmentResult>("file.attach", {
            data_url: dataUrl,
            name: filename,
            path: filename,
            session_id: sessionId,
          });
          text = result.ref_text || `[User attached file: ${result.name || filename}]`;
        }
        additions.push(text);
        chips.push({
          id: newId("attachment"),
          kind,
          name: result.name || result.filename || filename,
          text,
        });
      }
      setDraft((prev) => additions.reduce((next, addition) => appendDraftLine(next, addition), prev));
      setComposerAttachments((prev) => [...prev, ...chips]);
      pushActivity(`${files.length} file${files.length === 1 ? "" : "s"} attached`);
      navigator.vibrate?.(8);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [gateway, pushActivity, sessionId]);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => {
      const attachment = prev.find((item) => item.id === attachmentId);
      if (!attachment) return prev;
      setDraft((current) => removeDraftAttachmentLine(current, attachment.text));
      return prev.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const startFresh = useCallback(async () => {
    if (running) {
      const confirmed = window.confirm("Stop the current response and start a fresh chat?");
      if (!confirmed) return;
    }

    navigator.vibrate?.(6);
    const previousSessionId = sessionId;
    setSessionMenuOpen(false);
    setHandoffBusy(false);
    setError(null);

    if (previousSessionId) {
      try {
        if (running) {
          await gateway.request("session.interrupt", { session_id: previousSessionId });
        }
        await gateway.request("session.close", { session_id: previousSessionId });
      } catch (err) {
        pushActivity(err instanceof Error ? `fresh chat cleanup issue: ${err.message}` : "fresh chat cleanup issue");
      }
    }

    setForceNewForResume(resume ?? "__new__");
    setVersion((prev) => prev + 1);
    setMessages([]);
    setDraft("");
    setComposerAttachments([]);
    setActivityModel(emptyActivityModel());
    setRunning(false);
    setSessionId(null);
    clearNeedsInput();
  }, [clearNeedsInput, gateway, pushActivity, resume, running, sessionId]);

  const canPrepareHandoff = connection === "open" && Boolean(sessionId) && !running && messages.length > 0 && !needsInput && !handoffBusy;

  const handoffToFreshSession = useCallback(async () => {
    if (!sessionId || running || handoffBusy) return;
    navigator.vibrate?.(10);
    setSessionMenuOpen(false);
    setHandoffBusy(true);
    setError(null);
    pushActivity("preparing handoff");

    try {
      const result = await gateway.request<HandoffCreateResult>(
        "session.handoff_create",
        {
          cols: 88,
          focus_topic: "mobile continuation handoff to a new session",
          ...(profile ? { profile } : {}),
          session_id: sessionId,
          title: "Mobile handoff",
        },
        30_000,
      );
      const handoffSummary = result.handoff?.source_message_count
        ? `Carried over a clean summary from ${result.handoff.source_message_count} previous message${result.handoff.source_message_count === 1 ? "" : "s"}.`
        : "Carried over a clean summary from the previous chat.";
      setSessionId(result.session_id ?? null);
      setMessages([
        {
          id: newId("handoff"),
          role: "handoff",
          text: handoffSummary,
        },
        ...normalizeMessages(result.messages),
      ]);
      setInfo(result.info ?? {});
      setDraft("");
      setComposerAttachments([]);
      setActivityModel(emptyActivityModel());
      setRunning(Boolean(result.running));
      clearNeedsInput();
      pushActivity("handoff ready");
      setHandoffBusy(false);
    } catch (err) {
      setHandoffBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [clearNeedsInput, gateway, handoffBusy, profile, pushActivity, running, sessionId]);

  const applyModelSelection = useCallback(async ({
    confirmExpensiveModel = false,
    effort,
    model,
    provider,
  }: ModelSelection & { confirmExpensiveModel?: boolean }): Promise<ModelApplyResult> => {
    if (running) {
      throw new Error("Wait for the current turn to finish before switching models.");
    }

    const hostResult: ModelAssignmentResponse = await api.setModelAssignment({
      confirm_expensive_model: confirmExpensiveModel,
      model,
      provider,
      scope: "main",
    });
    if (hostResult.confirm_required) {
      return {
        confirm_message: hostResult.confirm_message,
        confirm_required: true,
      };
    }

    if (sessionId) {
      const liveResult = await gateway.request<GatewayConfigSetResult>("config.set", {
        confirm_expensive_model: confirmExpensiveModel,
        key: "model",
        session_id: sessionId,
        value: modelSwitchValue({ effort, model, provider }),
      });
      if (liveResult.confirm_required) {
        return {
          confirm_message: liveResult.confirm_message,
          confirm_required: true,
        };
      }
    }

    const config = await api.getConfig();
    await api.saveConfig(configWithReasoningEffort(config, effort));
    if (sessionId) {
      await gateway.request("config.set", {
        key: "reasoning",
        session_id: sessionId,
        value: effort,
      });
    }

    setInfo((prev) => ({
      ...prev,
      model,
      provider,
      reasoning_effort: effort,
    }));
    pushActivity(`model ${modelLabel(model)} · ${effort}`);
    return { confirm_required: false };
  }, [gateway, pushActivity, running, sessionId]);

  if (decisionPanelOpen) {
    return (
      <section className="hermes-mobile-card hermes-ios-surface hermes-mythic-frame relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.65rem]">
        <span aria-hidden="true" className="hermes-mythic-art hermes-mythic-art--menu" />
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-current/20 px-4">
          <Typography
            className="font-bold text-[1.125rem] leading-[0.95] tracking-[0.0525rem] text-midground uppercase"
            style={{ mixBlendMode: "plus-lighter" }}
          >
            Decision
            <br />
            Center
          </Typography>

          <Button
            ghost
            size="icon"
            onClick={closeDecisionPanel}
            aria-label="Close decision center"
            className="hermes-ios-tap h-11 w-11 rounded-full text-text-secondary hover:bg-midground/10 hover:text-midground"
          >
            <X />
          </Button>
        </div>
        <DecisionCenterSheet
          draft={inputDraft}
          needsInput={needsInput}
          notificationPermission={notificationPermission}
          onApproval={respondApproval}
          onClarify={respondClarify}
          onClose={closeDecisionPanel}
          onDraftChange={setInputDraft}
          onRequestNotifications={requestNotifications}
          onSecureSubmit={respondSecureInput}
          open
          presentation="pane"
          submitting={submittingInput}
        />
        {error && (
          <div className="mx-3 mb-3 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
            {error}
          </div>
        )}
      </section>
    );
  }

  const shellStyle: CSSProperties & {
    "--hermes-mobile-composer-height": string;
    "--hermes-mobile-keyboard-inset": string;
  } = {
    "--hermes-mobile-composer-height": `${composerHeight}px`,
    "--hermes-mobile-keyboard-inset": `${keyboardInset}px`,
  };

  return (
    <section
      className="hermes-mobile-chat-shell hermes-mobile-app relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"
      style={shellStyle}
    >
      <div className="hermes-mobile-chat-header hermes-mobile-app-header shrink-0 px-4">
        <div className="grid h-14 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigateFromMenu("/sessions?mobile=1")}
            className="hermes-mobile-back-button hermes-ios-tap grid h-11 w-11 place-items-center rounded-full text-[1.85rem] leading-none"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={() => setSecurityOpen(true)}
            aria-label={shieldStatusLabel}
            title={shieldStatusLabel}
            className="hermes-mobile-title-button hermes-ios-tap mx-auto inline-flex h-11 max-w-full items-center justify-center gap-2 rounded-full px-2"
          >
            <span className={cn("hermes-mobile-shield grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white", shieldStatusClass)}>
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="truncate text-[1.05rem] font-semibold tracking-[-0.02em]">
              Hermes Mobile
            </span>
          </button>

          <div className="relative flex justify-end">
            <Button
              ghost
              size="icon"
              title="More options"
              aria-label="More options"
              aria-expanded={sessionMenuOpen}
              onClick={() => {
                navigator.vibrate?.(4);
                setSessionMenuOpen((open) => !open);
              }}
              className="hermes-mobile-menu-button hermes-ios-tap h-10 w-10 rounded-full border"
            >
              {handoffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
            </Button>
            {sessionMenuOpen && (
              <div className="hermes-mobile-popover-menu hermes-session-menu absolute right-0 top-12 z-[70] w-[min(18.5rem,calc(100vw-2rem))] overflow-hidden rounded-[1.35rem] border p-1.5">
                <span aria-hidden="true" className="hermes-mobile-popover-arrow" />
                <div className="px-3 pb-1.5 pt-2 text-[0.78rem] font-semibold text-text-secondary">Start a new chat</div>
                <button
                  type="button"
                  onClick={() => void startFresh()}
                  className="hermes-mobile-menu-row hermes-mobile-menu-row--primary hermes-ios-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left"
                >
                  <span className="hermes-mobile-menu-icon grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem]">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5">Fresh chat</span>
                    <span className="block truncate text-[0.72rem] text-text-secondary">Start with no previous context.</span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!canPrepareHandoff}
                  onClick={() => void handoffToFreshSession()}
                  className="hermes-mobile-menu-row hermes-ios-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left disabled:opacity-45"
                >
                  <span className="hermes-mobile-menu-icon grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem]">
                    {handoffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5">Handoff from this chat</span>
                    <span className="block truncate text-[0.72rem] text-text-secondary">
                      {canPrepareHandoff ? "Carry over a clean summary." : "Available after an idle chat."}
                    </span>
                  </span>
                </button>
                <div className="hermes-mobile-menu-divider my-1 h-px" />
                <button
                  type="button"
                  onClick={() => navigateFromMenu("/sessions?mobile=1")}
                  className="hermes-mobile-menu-row hermes-ios-tap flex min-h-12 w-full items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left"
                >
                  <span className="hermes-mobile-menu-icon grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem]">
                    <List className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 text-sm font-semibold leading-5">Sessions</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSessionMenuOpen(false);
                    setModelSheetOpen(true);
                  }}
                  className="hermes-mobile-menu-row hermes-ios-tap flex min-h-12 w-full items-center gap-3 rounded-[0.9rem] px-3 py-2 text-left"
                >
                  <span className="hermes-mobile-menu-icon grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem]">
                    <Settings className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 text-sm font-semibold leading-5">Settings</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {securityOpen && <SecurityStatsSheet connection={connection} onClose={() => setSecurityOpen(false)} />}
      {modelSheetOpen && (
        <ModelChangerSheet
          currentEffort={info.reasoning_effort}
          currentModel={info.model}
          currentProvider={info.provider}
          onApply={applyModelSelection}
          onClose={() => setModelSheetOpen(false)}
          running={running}
        />
      )}

      <div ref={scrollRef} className="hermes-mobile-chat-scroll hermes-mobile-app-chat hermes-mobile-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col gap-4 px-1 py-2">
            <article className="hermes-mobile-bubble hermes-mobile-bubble--assistant mr-auto max-w-[88%] rounded-[1.25rem] border px-4 py-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.14em] text-text-secondary">
                <Bot className="h-3.5 w-3.5" />
                Hermes
              </div>
              <p className="leading-6">
                Hello. I can help run tasks across your private devices. What can I do for you?
              </p>
              <div className="mt-2 text-[0.68rem] text-text-secondary">Secure private network established.</div>
            </article>
            <article className="hermes-mobile-bubble hermes-mobile-bubble--user ml-auto max-w-[88%] rounded-[1.25rem] border px-4 py-3 text-sm">
              <p className="leading-6">
                Ask Hermes to organize files, check a session, or continue work on your Mac.
              </p>
            </article>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "hermes-mobile-bubble max-w-[92%] rounded-[1.1rem] border px-3.5 py-3 text-sm",
                  message.role === "user"
                    ? "hermes-mobile-bubble--user ml-auto"
                    : message.role === "handoff"
                      ? "hermes-mobile-bubble--handoff mx-auto max-w-full"
                    : message.role === "assistant"
                      ? "hermes-mobile-bubble--assistant mr-auto"
                      : "hermes-mobile-bubble--system mx-auto max-w-full border-warning/25 bg-warning/10 text-warning",
                )}
              >
                {message.role !== "user" && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.14em] opacity-70">
                    {message.role === "assistant" ? <Bot className="h-3 w-3" /> : null}
                    {message.role === "handoff" ? <FileText className="h-3 w-3" /> : null}
                    {message.role === "tool" ? <Wrench className="h-3 w-3" /> : null}
                    {message.role === "system" ? <AlertCircle className="h-3 w-3" /> : null}
                    {message.role === "assistant" ? "Hermes" : message.role === "handoff" ? "Handoff ready" : message.role}
                  </div>
                )}
                {message.role === "assistant" && message.streaming && message.text.trim().length === 0 ? (
                  <MobileAgentActivityCard cards={visibleActivityCards} />
                ) : message.role === "assistant" ? (
                  <Markdown content={message.text} streaming={message.streaming} />
                ) : (
                  <p className="whitespace-pre-wrap break-words leading-6">{message.text}</p>
                )}
              </article>
            ))}
            {running && !hasVisibleTypingBubble && (
              <article className="hermes-mobile-bubble hermes-mobile-bubble--assistant mr-auto max-w-[92%] rounded-[1.1rem] border px-3.5 py-3 text-sm">
                <div className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.14em] opacity-70">
                  <Bot className="h-3 w-3" />
                  Hermes
                </div>
                <MobileAgentActivityCard cards={visibleActivityCards} />
              </article>
            )}
          </div>
        )}

      </div>

      {needsInput && !decisionPanelOpen && (
        <NeedsInputSheet
          draft={inputDraft}
          needsInput={needsInput}
          onApproval={respondApproval}
          onCancelSecure={() => respondSecureInput("")}
          onClarify={respondClarify}
          onDraftChange={setInputDraft}
          onSecureSubmit={respondSecureInput}
          submitting={submittingInput}
        />
      )}

      <DecisionCenterSheet
        draft={inputDraft}
        needsInput={needsInput}
        notificationPermission={notificationPermission}
        onApproval={respondApproval}
        onClarify={respondClarify}
        onClose={closeDecisionPanel}
        onDraftChange={setInputDraft}
        onRequestNotifications={requestNotifications}
        onSecureSubmit={respondSecureInput}
        open={decisionPanelOpen}
        submitting={submittingInput}
      />

      {error && (
        <div className="mx-3 mb-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {error}
        </div>
      )}

      <form ref={composerRef} onSubmit={submit} className="hermes-mobile-composer hermes-mobile-app-composer shrink-0 px-3 py-2">
        {composerAttachments.length > 0 && (
          <div className="hermes-mobile-attachment-tray mb-2 flex gap-1.5 overflow-x-auto px-0.5">
            {composerAttachments.map((attachment) => (
              <span key={attachment.id} className="hermes-mobile-attachment-chip">
                <FileText className="h-3.5 w-3.5" />
                <span>{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => removeComposerAttachment(attachment.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void attachFiles(event.currentTarget.files)}
          />
          <Button
            type="button"
            onClick={openFilePicker}
            disabled={connection !== "open" || !sessionId || running || attachingFiles || Boolean(needsInput)}
            aria-label="Upload files"
            title="Upload files"
            className="hermes-ios-tap mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-midground/20 bg-midground/10 p-0 text-center text-midground shadow-[0_0_24px_rgba(45,212,191,0.16)] disabled:opacity-40 disabled:shadow-none"
          >
            <span className="relative z-10 grid h-full w-full place-items-center rounded-full">
              {attachingFiles ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            </span>
          </Button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={connection === "open" ? "Ask Hermes…" : "Connecting to Hermes…"}
            disabled={Boolean(needsInput)}
            className="hermes-mobile-composer-field min-h-12 min-w-0 flex-1 resize-none px-4 py-3 text-base leading-6 outline-none placeholder:text-text-secondary/65"
            rows={1}
          />
          {running ? (
            <Button
              type="button"
              onClick={interrupt}
              aria-label="Stop response"
              className="hermes-ios-tap mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-warning/35 bg-warning/15 p-0 text-center text-warning hover:bg-warning/20"
            >
              <span className="grid h-full w-full place-items-center">
                <CircleStop className="h-5 w-5" />
              </span>
            </Button>
          ) : (
            draft.trim().length === 0 ? (
              <Button
                type="button"
                onClick={nudgeVoice}
                title="Voice ready"
                aria-label="Voice ready"
                style={contextRingStyle}
                className="hermes-ios-tap relative mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-visible rounded-full border border-emerald-200/35 bg-emerald-300/16 p-0 text-center text-emerald-100 shadow-[0_0_28px_rgba(45,212,191,0.18)] hover:bg-emerald-300/22"
              >
                <span aria-hidden="true" className="hermes-context-ring" />
                <span className="relative z-10 grid h-full w-full place-items-center rounded-full">
                  <Mic className="h-5 w-5" />
                </span>
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                style={contextRingStyle}
                className="hermes-ios-tap relative mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-visible rounded-full border border-midground/25 bg-midground p-0 text-center text-background-base shadow-[0_10px_28px_rgba(255,230,203,0.18)] disabled:opacity-40 disabled:shadow-none"
              >
                <span aria-hidden="true" className="hermes-context-ring" />
                {connection === "connecting" ? (
                  <span className="relative z-10 grid h-full w-full place-items-center rounded-full">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </span>
                ) : (
                  <span className="relative z-10 grid h-full w-full place-items-center rounded-full">
                    <ArrowUp className="h-5 w-5" />
                  </span>
                )}
              </Button>
            )
          )}
        </div>
      </form>
    </section>
  );
}
