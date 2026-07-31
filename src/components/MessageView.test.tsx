import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageView } from "./MessageView";
import type { Message } from "../types";

describe("MessageView", () => {
  it("renders assistant markdown and processing duration", () => {
    const message: Message = {
      id: "message-1",
      conversationId: "conversation-1",
      role: "assistant",
      kind: "text",
      content: "**完成**",
      metadata: JSON.stringify({ durationMs: 1250 }),
      createdAt: "2026-07-31T00:00:00Z",
    };
    render(<MessageView message={message} />);
    expect(screen.getByText("完成").tagName).toBe("STRONG");
    expect(screen.getByText("处理用时 1.3 秒")).toBeInTheDocument();
  });
});
