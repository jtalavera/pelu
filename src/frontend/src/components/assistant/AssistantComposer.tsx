import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Textarea } from "@design-system";
import { SendIcon } from "./AssistantIcons";

const MAX_CHARS = 2000;

/**
 * Message box of the assistant. A `<form>` with a submit button, so clicking it and pressing Enter
 * do the same; Shift+Enter inserts a line break. It never sends on its own.
 */
export function AssistantComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Ready to type as soon as the panel opens, and again after each answer.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter confirming an IME candidate must not send the message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-line bg-surface p-3"
      data-testid="assistant-composer"
    >
      <Textarea
        ref={inputRef}
        data-testid="assistant-input"
        aria-label={t("femme.assistant.inputLabel")}
        placeholder={t("femme.assistant.inputPlaceholder")}
        rows={1}
        maxLength={MAX_CHARS}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-11 max-h-32 min-w-0 flex-1 resize-none py-2.5"
      />
      <Button
        type="submit"
        data-testid="assistant-send"
        aria-label={t("femme.assistant.send")}
        disabled={disabled || text.trim() === ""}
        className="min-h-11 min-w-11 shrink-0 px-3"
      >
        <SendIcon />
      </Button>
    </form>
  );
}
