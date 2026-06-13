import { Button } from "@nous-research/ui/ui/components/button";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  CircleStop,
  HelpCircle,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  TerminalSquare,
  X,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Markdown } from "@/components/Markdown";
import { GatewayClient, type ConnectionState, type GatewayEvent } from "@/lib/gatewayClient";
import { cn } from "@/lib/utils";

interface MobileChatSurfaceProps {
  active: boolean;
  profile?: string;
  resume?: string | null;
}

type ChatRole = "assistant" | "system" | "tool" | "user";

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
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
  };
  running?: boolean;
}

interface TextPayload {
  text?: string;
  rendered?: string;
  status?: string;
  warning?: string;
}

interface ToolPayload {
  tool_id?: string;
  name?: string;
  context?: string;
  status?: string;
  summary?: string;
}

interface StatusPayload {
  kind?: string;
  text?: string;
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

const ACTIVITY_LIMIT = 5;

function messageText(row: { text?: string; content?: string; name?: string; context?: string }): string {
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  if (typeof row.context === "string") return row.context;
  if (typeof row.name === "string") return row.name;
  return "";
}

function normalizeMessages(rows: SessionPayload["messages"]): ChatMessage[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row, index) => {
      const role = row.role === "user" || row.role === "assistant" || row.role === "tool"
        ? row.role
        : "system";
      const text = messageText(row).trim();
      if (!text) return null;
      return {
        id: `history-${index}-${role}`,
        role,
        text,
      } satisfies ChatMessage;
    })
    .filter((row): row is ChatMessage => row !== null);
}

function connectionLabel(state: ConnectionState, running: boolean, needsInput: boolean): string {
  if (needsInput) return "needs input";
  if (running) return "thinking";
  if (state === "open") return "ready";
  if (state === "connecting") return "connecting";
  if (state === "error") return "connection issue";
  return state;
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
            <p className="text-sm leading-6 text-text-secondary">{needsInput.description}</p>
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
                onClick={() => void onApproval("session")}
                className="hermes-ios-tap col-span-2 h-11 rounded-2xl border border-midground/15 bg-midground/10 text-midground hover:bg-midground/15"
              >
                <PromptSpinner show={submitting === "session"} />
                Approve this session
              </Button>
              {needsInput.allowPermanent && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void onApproval("always")}
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

export function MobileChatSurface({ active, profile = "", resume = null }: MobileChatSurfaceProps) {
  const [version, setVersion] = useState(0);
  const [forceNewForResume, setForceNewForResume] = useState<string | null>(null);
  // Version intentionally rebuilds the WebSocket client for the in-place "new chat"
  // action without remounting the whole dashboard route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gateway = useMemo(() => new GatewayClient(), [version]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [storedSessionId, setStoredSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [info, setInfo] = useState<NonNullable<SessionPayload["info"]>>({});
  const [needsInput, setNeedsInput] = useState<NeedsInput | null>(null);
  const [inputDraft, setInputDraft] = useState("");
  const [submittingInput, setSubmittingInput] = useState<null | string>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const pushActivity = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setActivity((prev) => [clean, ...prev.filter((item) => item !== clean)].slice(0, ACTIVITY_LIMIT));
  }, []);

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
      if (ev.payload?.warning) pushActivity(ev.payload.warning);
    });
    const offStatus = gateway.on<StatusPayload>("status.update", (ev) => {
      pushActivity(ev.payload?.text ?? "");
    });
    const offToolStart = gateway.on<ToolPayload>("tool.start", (ev) => {
      const p = ev.payload;
      pushActivity(`${p?.name ?? "tool"}${p?.context ? `: ${p.context}` : ""}`);
    });
    const offToolProgress = gateway.on<ToolPayload>("tool.progress", (ev) => {
      if (ev.payload?.summary) pushActivity(ev.payload.summary);
    });
    const offToolComplete = gateway.on<ToolPayload>("tool.complete", (ev) => {
      if (ev.payload?.status && ev.payload.status !== "ok") {
        pushActivity(`${ev.payload.name ?? "tool"} ${ev.payload.status}`);
      }
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
        setStoredSessionId(result.stored_session_id ?? result.resumed ?? null);
        setMessages(normalizeMessages(result.messages));
        setInfo(result.info ?? {});
        setRunning(Boolean(result.running));
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
      offState();
      offInfo();
      offStart();
      offDelta();
      offComplete();
      offStatus();
      offToolStart();
      offToolProgress();
      offToolComplete();
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
  }, [messages, activity]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(160, Math.max(48, textarea.scrollHeight))}px`;
  }, [draft]);

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

  const canSend = connection === "open" && Boolean(sessionId) && draft.trim().length > 0 && !running && !needsInput;

  const submit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId || running) return;

    navigator.vibrate?.(8);
    setDraft("");
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

  const startFresh = useCallback(() => {
    navigator.vibrate?.(6);
    setForceNewForResume(resume ?? "__new__");
    setVersion((prev) => prev + 1);
    setMessages([]);
    setDraft("");
    setActivity([]);
    setError(null);
    setRunning(false);
    setSessionId(null);
    setStoredSessionId(null);
    clearNeedsInput();
  }, [clearNeedsInput, resume]);

  return (
    <section className="hermes-mobile-card hermes-ios-surface relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.65rem]">
      <div className="shrink-0 border-b border-midground/10 bg-background-base/45 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.16em] text-text-secondary">
              <Sparkles className="h-3.5 w-3.5" />
              Mobile chat
            </div>
            <Typography className="mt-1 truncate text-[1.05rem] font-semibold leading-tight text-midground">
              Hermes
            </Typography>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.13em]",
                running
                  ? "border-warning/45 bg-warning/10 text-warning"
                  : needsInput
                    ? "border-warning/45 bg-warning/10 text-warning"
                  : connection === "open"
                    ? "border-success/35 bg-success/10 text-success"
                    : "border-current/20 bg-current/5 text-text-secondary",
              )}
            >
              {connectionLabel(connection, running, Boolean(needsInput))}
            </span>
            <Button
              ghost
              size="icon"
              title="Start fresh mobile chat"
              aria-label="Start fresh mobile chat"
              onClick={startFresh}
              className="hermes-ios-tap h-11 w-11 rounded-full border border-current/15 text-text-secondary hover:bg-midground/10 hover:text-midground"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-0.5 text-[0.72rem] text-text-secondary scrollbar-none">
          <span className="shrink-0 rounded-full border border-current/10 bg-current/5 px-2.5 py-1">
            {info.model || "model loading"}
          </span>
          {profile && (
            <span className="shrink-0 rounded-full border border-current/10 bg-current/5 px-2.5 py-1">
              {profile}
            </span>
          )}
          {(storedSessionId || sessionId) && (
            <span className="shrink-0 rounded-full border border-current/10 bg-current/5 px-2.5 py-1 font-mono-ui">
              {storedSessionId || sessionId}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="hermes-mobile-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-center px-3 py-10 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-midground/15 bg-midground/8 text-midground">
              <Bot className="h-6 w-6" />
            </div>
            <Typography className="mt-5 text-xl font-semibold text-midground">
              Ask Hermes from your phone
            </Typography>
            <p className="mx-auto mt-2 max-w-[18rem] text-sm leading-6 text-text-secondary">
              This is the desktop-style chat surface: readable messages, markdown,
              streaming status, and a real mobile composer — no terminal prompt.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "hermes-mobile-card max-w-[92%] rounded-[1.25rem] border px-3.5 py-3 text-sm shadow-sm",
                  message.role === "user"
                    ? "ml-auto border-midground/20 bg-midground text-background-base shadow-[0_12px_32px_rgba(255,230,203,0.13)]"
                    : message.role === "assistant"
                      ? "mr-auto border-midground/12 bg-background-base/55 text-foreground backdrop-blur-xl"
                      : "mx-auto max-w-full border-warning/25 bg-warning/10 text-warning",
                )}
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.14em] opacity-70">
                  {message.role === "assistant" ? <Bot className="h-3 w-3" /> : null}
                  {message.role === "tool" ? <Wrench className="h-3 w-3" /> : null}
                  {message.role === "system" ? <AlertCircle className="h-3 w-3" /> : null}
                  {message.role === "user" ? "You" : message.role === "assistant" ? "Hermes" : message.role}
                </div>
                {message.role === "assistant" ? (
                  <Markdown content={message.text} streaming={message.streaming} />
                ) : (
                  <p className="whitespace-pre-wrap break-words leading-6">{message.text}</p>
                )}
              </article>
            ))}
          </div>
        )}

        {activity.length > 0 && (
          <div className="hermes-mobile-card mt-4 rounded-[1.25rem] border border-midground/10 bg-background-base/45 p-3 text-xs text-text-secondary backdrop-blur-xl">
            <div className="mb-2 flex items-center gap-2 uppercase tracking-[0.14em]">
              <TerminalSquare className="h-3.5 w-3.5" />
              Activity
            </div>
            <div className="space-y-1.5">
              {activity.map((item, index) => (
                <div key={`${item}-${index}`} className="truncate">{item}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {needsInput && (
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

      {error && (
        <div className="mx-3 mb-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="shrink-0 border-t border-midground/10 bg-background-base/70 p-3 backdrop-blur-xl">
        <div className="flex items-end gap-2 rounded-[1.45rem] border border-midground/15 bg-[color-mix(in_srgb,var(--midground-base)_5%,var(--background-base))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.22)]">
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
            placeholder={connection === "open" ? "Message Hermes…" : "Connecting to Hermes…"}
            disabled={Boolean(needsInput)}
            className="min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-base leading-6 text-midground outline-none placeholder:text-text-secondary/65"
            rows={1}
          />
          {running ? (
            <Button
              type="button"
              onClick={interrupt}
              aria-label="Stop response"
              className="hermes-ios-tap mb-0.5 h-11 w-11 rounded-full border border-warning/35 bg-warning/15 p-0 text-warning hover:bg-warning/20"
            >
              <CircleStop className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className="hermes-ios-tap mb-0.5 h-11 w-11 rounded-full border border-midground/25 bg-midground p-0 text-background-base shadow-[0_10px_28px_rgba(255,230,203,0.18)] disabled:opacity-40 disabled:shadow-none"
            >
              {connection === "connecting" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </Button>
          )}
        </div>
        <div className="mt-2 px-2 text-[0.68rem] text-text-secondary/75">
          Enter sends. Shift+Enter adds a line.
        </div>
      </form>
    </section>
  );
}
