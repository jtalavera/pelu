import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Textarea } from "@design-system";
import type { DictationEngine, DictationErrorCode } from "../../assistant/dictation";
import { useSpeechDictation } from "../../hooks/useSpeechDictation";
import { MicIcon, SendIcon, StopIcon } from "./AssistantIcons";

const MAX_CHARS = 2000;

/**
 * Message box of the assistant. A `<form>` with a submit button, so clicking it and pressing Enter
 * do the same; Shift+Enter inserts a line break. It never sends on its own.
 *
 * Dictation (HU-AST-07) only FILLS the box: what is heard appears as text, the person reviews or
 * edits it and sends it. A message in which the microphone was used is sent as `VOICE` (shown as
 * «Dictado») even if it was edited afterwards; clearing the box starts over.
 */
export function AssistantComposer({
  disabled,
  onSend,
  dictationEngine,
}: {
  disabled: boolean;
  onSend: (text: string, inputMode?: "VOICE") => void;
  /** Tests inject a fake microphone; the app uses Azure AI Speech (or the Playwright simulation). */
  dictationEngine?: DictationEngine;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [dictationError, setDictationError] = useState<DictationErrorCode | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // What was in the box before dictating + what the microphone finished: the live (partial) text
  // goes after it. A ref, because the engine calls back outside of React's render.
  const baseRef = useRef("");
  const textRef = useRef("");
  const dictatedRef = useRef(false);

  const put = (value: string) => {
    textRef.current = value;
    setText(value);
  };

  const dictation = useSpeechDictation({
    language: i18n.language,
    engine: dictationEngine,
    onPartial: (partial) => {
      if (partial) dictatedRef.current = true;
      put((baseRef.current + partial).slice(0, MAX_CHARS));
    },
    onFinal: (finalText) => {
      dictatedRef.current = true;
      baseRef.current = `${baseRef.current}${finalText} `;
      put(baseRef.current.slice(0, MAX_CHARS));
    },
    onError: setDictationError,
  });

  // Ready to type as soon as the panel opens, and again after each answer.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  // The assistant is answering (or the conversation is being replaced): the microphone goes off.
  useEffect(() => {
    if (disabled) void dictation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  function toggleDictation() {
    setDictationError(null);
    if (dictation.state === "idle") {
      baseRef.current = textRef.current && !/\s$/.test(textRef.current) ? `${textRef.current} ` : textRef.current;
      void dictation.start();
    } else {
      void dictation.stop();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void dictation.stop();
    if (dictatedRef.current) onSend(trimmed, "VOICE");
    else onSend(trimmed);
    dictatedRef.current = false;
    baseRef.current = "";
    setDictationError(null);
    put("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter confirming an IME candidate must not send the message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const listening = dictation.listening;
  const starting = dictation.starting;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-line bg-surface p-3"
      data-testid="assistant-composer"
      data-busy={disabled ? "true" : "false"}
      data-dictation={dictation.state}
      aria-busy={disabled}
    >
      {(listening || starting) && (
        <p role="status" data-testid="assistant-dictation-status" className="text-sm text-ink-2">
          {listening
            ? t("femme.assistant.dictation.listening")
            : t("femme.assistant.dictation.starting")}
        </p>
      )}
      {dictationError && (
        <Alert variant="destructive" data-testid="assistant-dictation-error">
          {t(`femme.assistant.dictation.errors.${dictationError}`)}
        </Alert>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={inputRef}
          data-testid="assistant-input"
          aria-label={t("femme.assistant.inputLabel")}
          placeholder={t("femme.assistant.inputPlaceholder")}
          rows={1}
          maxLength={MAX_CHARS}
          value={text}
          onChange={(e) => {
            // Typing takes over from the microphone; an emptied box is a new message.
            if (dictation.state !== "idle") void dictation.stop();
            if (e.target.value.trim() === "") dictatedRef.current = false;
            put(e.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-h-11 max-h-32 min-w-0 flex-1 resize-none py-2.5"
        />
        <Button
          type="button"
          variant={listening ? "primary" : "secondary"}
          data-testid="assistant-mic"
          aria-label={listening ? t("femme.assistant.dictation.stop") : t("femme.assistant.dictation.start")}
          aria-pressed={listening}
          disabled={disabled || starting}
          onClick={toggleDictation}
          className="min-h-11 min-w-11 shrink-0 px-3 sm:h-11 sm:min-h-11 sm:min-w-11"
        >
          {listening ? <StopIcon className="animate-pulse" /> : <MicIcon />}
        </Button>
        <Button
          type="submit"
          data-testid="assistant-send"
          aria-label={t("femme.assistant.send")}
          disabled={disabled || text.trim() === ""}
          className="min-h-11 min-w-11 shrink-0 px-3 sm:h-11 sm:min-h-11 sm:min-w-11"
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}
