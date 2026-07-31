import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer, resizeComposerTextarea } from "./Composer";
import type { Conversation } from "../types";

const conversation: Conversation = {
  id: "conversation-1",
  claudeSessionId: "session-1",
  title: "测试项目",
  projectPath: "/tmp/example-project",
  model: "sonnet",
  permissionMode: "default",
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};

const renderComposer = (overrides: Partial<React.ComponentProps<typeof Composer>> = {}) => {
  const props: React.ComponentProps<typeof Composer> = {
    active: conversation,
    value: "hello",
    isRunning: false,
    cliFound: true,
    modelOptions: [{ value: "sonnet", label: "Sonnet" }],
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
};

describe("Composer", () => {
  it("submits on Enter but keeps Shift+Enter for a new line", () => {
    const props = renderComposer();
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("caps automatic textarea height and enables scrolling", () => {
    const textarea = document.createElement("textarea");
    Object.defineProperty(textarea, "scrollHeight", { value: 240, configurable: true });
    resizeComposerTextarea(textarea);
    expect(textarea.style.height).toBe("170px");
    expect(textarea.style.overflowY).toBe("auto");
  });
});
