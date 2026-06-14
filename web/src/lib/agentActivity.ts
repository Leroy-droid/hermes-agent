import type { GatewayEvent } from "@/lib/gatewayClient";

export type AgentActivityKind =
  | "thinking"
  | "writing"
  | "tool"
  | "subagent"
  | "decision"
  | "status"
  | "background"
  | "notification"
  | "error"
  | "system";

export type AgentActivityState =
  | "pending"
  | "running"
  | "blocked"
  | "complete"
  | "failed"
  | "interrupted";

export type AgentActivitySource =
  | "message"
  | "status"
  | "tool"
  | "subagent"
  | "approval"
  | "clarify"
  | "sudo"
  | "secret"
  | "background"
  | "notification"
  | "error"
  | "unknown";

export interface AgentActivity {
  id: string;
  sessionId?: string;
  kind: AgentActivityKind;
  state: AgentActivityState;
  title: string;
  summary?: string;
  detail?: string;
  source: AgentActivitySource;
  rawType: string;
  eventKey?: string;
  parentId?: string;
  priority?: "low" | "normal" | "high";
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    apiCalls?: number;
    costUsd?: number;
    filesRead?: number;
    filesWritten?: number;
    toolCount?: number;
  };
  raw?: unknown;
}

export interface ActivityModel {
  cards: AgentActivity[];
  byKey: Record<string, string>;
}

interface ToolPayload {
  args_text?: string;
  context?: string;
  duration_s?: number;
  inline_diff?: string;
  name?: string;
  result_text?: string;
  status?: string;
  summary?: string;
  todos?: Array<{ status?: string }>;
  tool_id?: string;
}

interface TextPayload {
  status?: string;
  warning?: string;
}

interface StatusPayload {
  kind?: string;
  text?: string;
}

interface DecisionPayload {
  command?: string;
  description?: string;
  env_var?: string;
  prompt?: string;
  question?: string;
  request_id?: string;
}

interface SubagentPayload {
  api_calls?: number;
  child_session_id?: string;
  cost_usd?: number;
  duration_seconds?: number;
  files_read?: string[];
  files_written?: string[];
  goal?: string;
  input_tokens?: number;
  output_tokens?: number;
  parent_id?: string;
  reasoning_tokens?: number;
  status?: string;
  subagent_id?: string;
  summary?: string;
  task_index?: number;
  text?: string;
  tool_count?: number;
  tool_name?: string;
  tool_preview?: string;
}

const STORED_ACTIVITY_LIMIT = 50;

export function emptyActivityModel(): ActivityModel {
  return { byKey: {}, cards: [] };
}

export function applyGatewayEventToActivities(
  model: ActivityModel,
  event: GatewayEvent,
  now = Date.now(),
): ActivityModel {
  const patch = eventToActivityPatch(event, now);
  if (!patch) return model;
  return upsertActivity(model, patch);
}

export function getVisibleActivityCards(model: ActivityModel, limit = 6): AgentActivity[] {
  return model.cards.slice(Math.max(0, model.cards.length - limit));
}

function eventToActivityPatch(event: GatewayEvent, now: number): AgentActivity | null {
  const type = String(event.type || "");
  const sessionId = event.session_id;

  if (type === "message.start") {
    return {
      id: "",
      eventKey: messageKey(sessionId),
      kind: "writing",
      priority: "normal",
      raw: event,
      rawType: type,
      sessionId,
      source: "message",
      startedAt: now,
      state: "running",
      summary: "Hermes is composing a response.",
      title: "Writing Agent",
      updatedAt: now,
    };
  }

  if (type === "message.delta") {
    return {
      id: "",
      eventKey: messageKey(sessionId),
      kind: "writing",
      priority: "normal",
      raw: event,
      rawType: type,
      sessionId,
      source: "message",
      startedAt: now,
      state: "running",
      summary: "Response is streaming.",
      title: "Writing Agent",
      updatedAt: now,
    };
  }

  if (type === "message.complete") {
    const payload = asObject<TextPayload>(event.payload);
    const state = messageState(payload.status);
    return {
      endedAt: now,
      eventKey: messageKey(sessionId),
      id: "",
      kind: "writing",
      priority: payload.warning ? "high" : "normal",
      raw: event,
      rawType: type,
      sessionId,
      source: "message",
      startedAt: now,
      state,
      summary: payload.warning || (state === "interrupted" ? "Hermes stopped writing." : "Hermes finished writing."),
      title: state === "interrupted" ? "Response stopped" : state === "failed" ? "Response failed" : "Response ready",
      updatedAt: now,
    };
  }

  if (type === "tool.generating") {
    const payload = asObject<ToolPayload>(event.payload);
    const name = clean(payload.name) || "tool";
    return {
      eventKey: `toolgen:${sessionId || "session"}:${name}`,
      id: "",
      kind: "tool",
      parentId: messageKey(sessionId),
      raw: event,
      rawType: type,
      sessionId,
      source: "tool",
      startedAt: now,
      state: "pending",
      summary: "Preparing to use a tool.",
      title: naturalToolPendingTitle(name),
      updatedAt: now,
    };
  }

  if (type === "tool.start") {
    const payload = asObject<ToolPayload>(event.payload);
    const name = clean(payload.name) || "tool";
    const key = payload.tool_id ? `tool:${payload.tool_id}` : `tool:${sessionId || "session"}:${name}`;
    return {
      detail: clean(payload.args_text),
      eventKey: key,
      id: "",
      kind: "tool",
      parentId: messageKey(sessionId),
      raw: event,
      rawType: type,
      sessionId,
      source: "tool",
      startedAt: now,
      state: "running",
      summary: naturalToolSummary(name, payload.context),
      title: naturalToolTitle(name),
      updatedAt: now,
    };
  }

  if (type === "tool.complete") {
    const payload = asObject<ToolPayload>(event.payload);
    const name = clean(payload.name) || "tool";
    const key = payload.tool_id ? `tool:${payload.tool_id}` : `tool:${sessionId || "session"}:${name}`;
    const failed = Boolean(payload.status && payload.status !== "ok" && payload.status !== "complete");
    return {
      detail: clean(payload.result_text || payload.inline_diff),
      endedAt: now,
      eventKey: key,
      id: "",
      kind: "tool",
      metrics: toolMetrics(payload),
      parentId: messageKey(sessionId),
      priority: failed ? "high" : "normal",
      raw: event,
      rawType: type,
      sessionId,
      source: "tool",
      startedAt: now,
      state: failed ? "failed" : "complete",
      summary: clean(payload.summary) || naturalToolDone(name, payload),
      title: failed ? `${naturalToolTitle(name)} failed` : naturalToolCompleteTitle(name, payload),
      updatedAt: now,
    };
  }

  if (type.startsWith("subagent.")) {
    return subagentActivity(type, asObject<SubagentPayload>(event.payload), sessionId, event, now);
  }

  if (type === "approval.request") {
    const payload = asObject<DecisionPayload>(event.payload);
    return decisionActivity({
      detail: clean(payload.command),
      event,
      eventKey: `approval:${sessionId || "session"}`,
      now,
      sessionId,
      source: "approval",
      summary: clean(payload.description) || "Hermes needs permission to continue.",
      title: "Approval needed",
      type,
    });
  }

  if (type === "clarify.request") {
    const payload = asObject<DecisionPayload>(event.payload);
    return decisionActivity({
      event,
      eventKey: payload.request_id ? `clarify:${payload.request_id}` : `clarify:${sessionId || "session"}`,
      now,
      sessionId,
      source: "clarify",
      summary: clean(payload.question) || "Hermes needs more information.",
      title: "Clarification needed",
      type,
    });
  }

  if (type === "sudo.request") {
    const payload = asObject<DecisionPayload>(event.payload);
    return decisionActivity({
      event,
      eventKey: payload.request_id ? `sudo:${payload.request_id}` : `sudo:${sessionId || "session"}`,
      now,
      sessionId,
      source: "sudo",
      summary: "Hermes needs your sudo password for this request.",
      title: "Password needed",
      type,
    });
  }

  if (type === "secret.request") {
    const payload = asObject<DecisionPayload>(event.payload);
    const envVar = clean(payload.env_var);
    return decisionActivity({
      event,
      eventKey: payload.request_id ? `secret:${payload.request_id}` : `secret:${sessionId || "session"}`,
      now,
      sessionId,
      source: "secret",
      summary: envVar ? `Enter ${envVar} to continue.` : clean(payload.prompt) || "Enter the requested secret.",
      title: "Secret needed",
      type,
    });
  }

  if (type === "status.update") {
    const payload = asObject<StatusPayload>(event.payload);
    const text = clean(payload.text);
    if (!text) return null;
    return {
      eventKey: `status:${sessionId || "session"}:${payload.kind || "status"}`,
      id: "",
      kind: "status",
      priority: "low",
      raw: event,
      rawType: type,
      sessionId,
      source: "status",
      startedAt: now,
      state: text.toLowerCase().includes("ready") ? "complete" : "running",
      summary: naturalizeStatus(text),
      title: payload.kind === "goal" ? "Checking goal progress" : payload.kind === "process" ? "Process update" : "Working",
      updatedAt: now,
    };
  }

  if (type === "thinking.delta" || type === "reasoning.delta" || type === "reasoning.available") {
    return {
      eventKey: `thinking:${sessionId || "session"}`,
      id: "",
      kind: "thinking",
      parentId: messageKey(sessionId),
      priority: "low",
      raw: event,
      rawType: type,
      sessionId,
      source: "message",
      startedAt: now,
      state: type === "reasoning.available" ? "complete" : "running",
      summary: type === "reasoning.available" ? "A reasoning summary is available." : "Hermes is planning the next step.",
      title: "Thinking",
      updatedAt: now,
    };
  }

  if (type === "background.complete") {
    const payload = asObject<{ task_id?: string; text?: string }>(event.payload);
    const text = clean(payload.text) || "Background task finished.";
    const failed = text.toLowerCase().startsWith("error:");
    return {
      endedAt: now,
      eventKey: payload.task_id ? `background:${payload.task_id}` : `background:${sessionId || "session"}`,
      id: "",
      kind: "background",
      priority: failed ? "high" : "normal",
      raw: event,
      rawType: type,
      sessionId,
      source: "background",
      startedAt: now,
      state: failed ? "failed" : "complete",
      summary: text,
      title: "Background task finished",
      updatedAt: now,
    };
  }

  if (type === "error") {
    const payload = asObject<{ message?: string }>(event.payload);
    return {
      endedAt: now,
      eventKey: `error:${sessionId || "session"}:${now}`,
      id: "",
      kind: "error",
      priority: "high",
      raw: event,
      rawType: type,
      sessionId,
      source: "error",
      startedAt: now,
      state: "failed",
      summary: clean(payload.message) || "An error occurred.",
      title: "Hermes hit an error",
      updatedAt: now,
    };
  }

  return null;
}

function upsertActivity(model: ActivityModel, patch: AgentActivity): ActivityModel {
  const key = patch.eventKey;
  const id = key ? model.byKey[key] : undefined;
  if (!id) {
    const nextId = key || `activity:${patch.rawType}:${patch.startedAt}:${model.cards.length}`;
    const card = { ...patch, id: nextId };
    const cards = [...model.cards, card].slice(-STORED_ACTIVITY_LIMIT);
    return rebuildIndex({ cards, byKey: { ...model.byKey, ...(key ? { [key]: nextId } : {}) } });
  }

  const cards = model.cards.map((card) => {
    if (card.id !== id) return card;
    return {
      ...card,
      ...patch,
      id,
      metrics: { ...card.metrics, ...patch.metrics },
      startedAt: card.startedAt,
      updatedAt: patch.updatedAt,
    };
  });
  return rebuildIndex({ ...model, cards });
}

function rebuildIndex(model: ActivityModel): ActivityModel {
  const byKey: Record<string, string> = {};
  for (const card of model.cards) {
    if (card.eventKey) byKey[card.eventKey] = card.id;
  }
  return { cards: model.cards, byKey };
}

function subagentActivity(
  type: string,
  payload: SubagentPayload,
  sessionId: string | undefined,
  event: GatewayEvent,
  now: number,
): AgentActivity {
  const key = payload.subagent_id || payload.child_session_id || `${sessionId || "session"}:${payload.task_index ?? 0}`;
  const eventKey = `subagent:${key}`;
  const complete = type === "subagent.complete";
  const failed = complete && payload.status === "failed";
  const text = clean(payload.summary || payload.text || payload.goal);
  return {
    detail: clean(payload.tool_preview),
    endedAt: complete ? now : undefined,
    eventKey,
    id: "",
    kind: "subagent",
    metrics: subagentMetrics(payload),
    parentId: payload.parent_id ? `subagent:${payload.parent_id}` : messageKey(sessionId),
    priority: failed ? "high" : "normal",
    raw: event,
    rawType: type,
    sessionId,
    source: "subagent",
    startedAt: now,
    state: failed ? "failed" : complete ? "complete" : "running",
    summary: text || subagentFallbackSummary(type),
    title: subagentTitle(type, failed),
    updatedAt: now,
  };
}

function decisionActivity(args: {
  detail?: string;
  event: GatewayEvent;
  eventKey: string;
  now: number;
  sessionId?: string;
  source: AgentActivitySource;
  summary: string;
  title: string;
  type: string;
}): AgentActivity {
  return {
    detail: args.detail,
    eventKey: args.eventKey,
    id: "",
    kind: "decision",
    priority: "high",
    raw: args.event,
    rawType: args.type,
    sessionId: args.sessionId,
    source: args.source,
    startedAt: args.now,
    state: "blocked",
    summary: args.summary,
    title: args.title,
    updatedAt: args.now,
  };
}

function messageKey(sessionId: string | undefined): string {
  return `message:${sessionId || "session"}`;
}

function asObject<T extends object>(value: unknown): Partial<T> {
  return value && typeof value === "object" ? (value as Partial<T>) : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageState(status: string | undefined): AgentActivityState {
  if (status === "interrupted") return "interrupted";
  if (status === "error" || status === "failed") return "failed";
  return "complete";
}

function naturalToolPendingTitle(name: string): string {
  if (name === "terminal" || name === "execute_code") return "Preparing command";
  if (name === "read_file") return "Preparing to read file";
  if (name === "search_files") return "Preparing file search";
  if (name === "web_search") return "Preparing web search";
  return "Preparing tool";
}

function naturalToolTitle(name: string): string {
  if (name === "read_file") return "Reading file";
  if (name === "search_files") return "Searching files";
  if (name === "write_file") return "Writing file";
  if (name === "patch") return "Editing files";
  if (name === "terminal" || name === "execute_code") return "Running command";
  if (name === "web_search") return "Searching the web";
  if (name === "web_extract") return "Reading web pages";
  if (name === "todo") return "Updating task list";
  if (name === "delegate_task") return "Starting another agent";
  if (name === "browser_navigate" || name.startsWith("browser_")) return "Using browser";
  return "Using tool";
}

function naturalToolSummary(name: string, context: unknown): string {
  const cleanContext = clean(context);
  if (name === "read_file" && cleanContext) return `Reading ${cleanContext}`;
  if (name === "search_files" && cleanContext) return `Looking for ${cleanContext}`;
  if (name === "web_search") return cleanContext ? `Searching for ${cleanContext}` : "Looking up current information.";
  if (name === "web_extract") return cleanContext ? `Opening ${cleanContext}` : "Opening source pages.";
  if (name === "terminal" || name === "execute_code") return cleanContext || "Using the terminal.";
  if (name === "todo") return "Tracking progress.";
  if (name === "delegate_task") return "Delegating part of the task.";
  return cleanContext || "Working with a tool.";
}

function naturalToolCompleteTitle(name: string, payload: ToolPayload): string {
  if (payload.inline_diff) return "Edited files";
  if (name === "todo" || payload.todos) return "Updated task list";
  if (name === "web_search") return "Web search complete";
  if (name === "web_extract") return "Source reading complete";
  return `${naturalToolTitle(name)} complete`;
}

function naturalToolDone(name: string, payload: ToolPayload): string {
  if (payload.todos) {
    const complete = payload.todos.filter((todo) => todo.status === "completed").length;
    const remaining = payload.todos.length - complete;
    return `${complete} complete, ${remaining} remaining.`;
  }
  if (payload.inline_diff) return "Changes are ready to review.";
  if (name === "read_file") return "Finished reading.";
  if (name === "search_files") return "Finished searching.";
  return "Finished.";
}

function naturalizeStatus(text: string): string {
  return text.replace(/^⠋\s*/, "").replace(/^✓\s*/, "").trim();
}

function toolMetrics(payload: ToolPayload): AgentActivity["metrics"] {
  return {
    durationMs: typeof payload.duration_s === "number" ? Math.round(payload.duration_s * 1000) : undefined,
  };
}

function subagentMetrics(payload: SubagentPayload): AgentActivity["metrics"] {
  return {
    apiCalls: payload.api_calls,
    costUsd: payload.cost_usd,
    durationMs: typeof payload.duration_seconds === "number" ? Math.round(payload.duration_seconds * 1000) : undefined,
    filesRead: Array.isArray(payload.files_read) ? payload.files_read.length : undefined,
    filesWritten: Array.isArray(payload.files_written) ? payload.files_written.length : undefined,
    inputTokens: payload.input_tokens,
    outputTokens: payload.output_tokens,
    reasoningTokens: payload.reasoning_tokens,
    toolCount: payload.tool_count,
  };
}

function subagentTitle(type: string, failed: boolean): string {
  if (failed) return "Subagent failed";
  if (type === "subagent.complete") return "Subagent finished";
  if (type === "subagent.tool") return "Subagent using tool";
  if (type === "subagent.thinking") return "Subagent thinking";
  if (type === "subagent.spawn_requested") return "Preparing subagent";
  return "Subagent working";
}

function subagentFallbackSummary(type: string): string {
  if (type === "subagent.complete") return "Delegated work completed.";
  if (type === "subagent.tool") return "A delegated agent is using a tool.";
  if (type === "subagent.thinking") return "Planning the delegated task.";
  return "A delegated agent is working.";
}
