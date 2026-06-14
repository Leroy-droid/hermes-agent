import type { SessionMessage } from "@/lib/api";

export function mobilePreviewChatMessages(
  messages: SessionMessage[],
): SessionMessage[] {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.content?.trim(),
    )
    .slice(-4);
}
