import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import {
  getCurrentAssistantConversation,
  startAssistantConversation,
  streamAssistantMessage,
  type AssistantConversation,
  type AssistantStreamEvent,
} from "../api/assistant";
import { isPinSession } from "../auth/sharedDevice";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { deriveAssistantPage } from "./currentPage";

export const ASSISTANT_FLAG = "ASSISTANT_CHATBOT";

export type AssistantUiMessage = {
  key: string;
  role: "USER" | "ASSISTANT";
  content: string;
  inputMode?: string | null;
  /** The assistant is still answering this one. */
  streaming?: boolean;
  /** Why this answer failed; the text already received (if any) is kept. */
  error?: Error | null;
};

export type AssistantState = {
  /** The flag is on for this tenant and the session may use it (not a PIN session). */
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  messages: AssistantUiMessage[];
  /** Reopening after a reload: the history is being fetched. */
  loadingHistory: boolean;
  historyError: Error | null;
  /** A message is being answered. */
  busy: boolean;
  /** Tool the assistant is running right now («Buscando clientes…»), if any. */
  activeTool: string | null;
  send: (text: string, inputMode?: "TEXT" | "VOICE") => Promise<void>;
  newConversation: () => Promise<void>;
};

const DISABLED: AssistantState = {
  enabled: false,
  open: false,
  setOpen: () => {},
  toggle: () => {},
  messages: [],
  loadingHistory: false,
  historyError: null,
  busy: false,
  activeTool: null,
  send: async () => {},
  newConversation: async () => {},
};

const AssistantContext = createContext<AssistantState>(DISABLED);

/** Without a provider (or with the flag off) the assistant simply does not exist. */
export function useAssistant(): AssistantState {
  return useContext(AssistantContext);
}

function fromHistory(c: AssistantConversation): AssistantUiMessage[] {
  return c.messages.map((m) => ({
    key: `h-${m.id}`,
    role: m.role,
    content: m.content,
    inputMode: m.inputMode,
  }));
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Lives in the app shell, so the conversation (and an answer still streaming) survives navigating
 * between screens and closing the panel. The history is fetched from the server the first time the
 * panel opens — which is also what restores it after a page reload.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const flagOn = useFeatureFlag(ASSISTANT_FLAG);
  const enabled = flagOn && !isPinSession();
  const { pathname } = useLocation();
  const currentPage = deriveAssistantPage(pathname);

  const [openRaw, setOpen] = useState(false);
  const open = openRaw && enabled;
  const [messages, setMessages] = useState<AssistantUiMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const conversationIdRef = useRef<number | null>(null);
  const historyLoadedRef = useRef(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const keyRef = useRef(0);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const nextKey = () => `m-${++keyRef.current}`;

  // First time the panel opens (or after a failed attempt): restore the conversation from the server.
  useEffect(() => {
    if (!open || historyLoadedRef.current || busyRef.current) return;
    historyLoadedRef.current = true;
    let cancelled = false;
    let settled = false;
    setLoadingHistory(true);
    setHistoryError(null);
    getCurrentAssistantConversation()
      .then((c) => {
        settled = true;
        if (cancelled) return;
        conversationIdRef.current = c.conversationId;
        setMessages(fromHistory(c));
      })
      .catch((e) => {
        settled = true;
        if (cancelled) return;
        historyLoadedRef.current = false; // reopening the panel retries
        setHistoryError(asError(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
      // Closed mid-load: the next open fetches again. Once loaded, the conversation stays in
      // memory (an answer may still be streaming) and is not replaced by a second fetch.
      if (!settled) {
        historyLoadedRef.current = false;
        setLoadingHistory(false);
      }
    };
  }, [open]);

  // Ctrl/Cmd + K toggles the assistant from anywhere.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchMessage = useCallback((key: string, patch: Partial<AssistantUiMessage>) => {
    setMessages((all) => all.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }, []);

  const send = useCallback(
    async (text: string, inputMode: "TEXT" | "VOICE" = "TEXT") => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const answerKey = nextKey();
      setMessages((all) => [
        ...all,
        { key: nextKey(), role: "USER", content: trimmed, inputMode },
        { key: answerKey, role: "ASSISTANT", content: "", streaming: true },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      let finished = false;
      try {
        let conversationId = conversationIdRef.current;
        if (conversationId == null) {
          const current = await getCurrentAssistantConversation();
          conversationId = current.conversationId;
          conversationIdRef.current = conversationId;
        }
        const onEvent = (event: AssistantStreamEvent) => {
          switch (event.type) {
            case "message.delta":
              setMessages((all) =>
                all.map((m) =>
                  m.key === answerKey ? { ...m, content: m.content + event.text } : m,
                ),
              );
              break;
            case "tool.status":
              setActiveTool(event.state === "running" ? event.tool : null);
              break;
            case "message.done":
              finished = true;
              break;
            case "error":
              finished = true;
              patchMessage(answerKey, { error: new Error(event.code) });
              break;
          }
        };
        await streamAssistantMessage(
          { conversationId, text: trimmed, inputMode, currentPage: currentPageRef.current },
          onEvent,
          controller.signal,
        );
        if (!finished) patchMessage(answerKey, { error: new Error("STREAM_INTERRUPTED") });
      } catch (e) {
        if (!controller.signal.aborted) patchMessage(answerKey, { error: asError(e) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        setActiveTool(null);
        patchMessage(answerKey, { streaming: false });
      }
    },
    [patchMessage],
  );

  const newConversation = useCallback(async () => {
    abortRef.current?.abort();
    // Locked until the new conversation exists: a message typed meanwhile would go to the old one
    // and then vanish when the panel is emptied.
    busyRef.current = true;
    setBusy(true);
    setActiveTool(null);
    setHistoryError(null);
    try {
      const fresh = await startAssistantConversation();
      conversationIdRef.current = fresh.conversationId;
      historyLoadedRef.current = true;
      setMessages(fromHistory(fresh));
    } catch (e) {
      setHistoryError(asError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const value = useMemo<AssistantState>(
    () =>
      enabled
        ? {
            enabled,
            open,
            setOpen,
            toggle: () => setOpen((o) => !o),
            messages,
            loadingHistory,
            historyError,
            busy,
            activeTool,
            send,
            newConversation,
          }
        : DISABLED,
    [
      enabled,
      open,
      messages,
      loadingHistory,
      historyError,
      busy,
      activeTool,
      send,
      newConversation,
    ],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
