import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Archive, ArchiveRestore, ChevronDown, ImagePlus, Menu, MessageSquarePlus, Send, Trash2, X } from "lucide-react";
import { createAiConversation, deleteAiConversation, getAiConversations, getAiMessages, sendAiMessageStream, updateAiConversation } from "../api";
import type { AiAttachment, AiConversation, AiMessage } from "../types";
import { userFacingError } from "../utils/errorCatalog";

const generateId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formatConvDate(iso: string) {
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleDateString("pt-BR");
}

async function readImages(files: FileList | File[]): Promise<AiAttachment[]> {
  const accepted = [...files]
    .filter((file) => /^image\/(png|jpeg|webp|gif)$/i.test(file.type) && file.size <= 2_000_000)
    .slice(0, 4);
  return Promise.all(
    accepted.map(
      (file) =>
        new Promise<AiAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export function AlphaBot({ requestLocalSession, onClose, theme }: { requestLocalSession: () => Promise<string>; onClose: () => void; theme: "light" | "dark" }) {
  const colors = useMemo(() => {
    if (theme === "light") {
      return {
        panelBg: "#ffffff",
        border: "#e0e3df",
        text: "#17202b",
        muted: "#687381",
        inputBg: "#f7f8f6",
        userBubble: "#e8f0fe",
        headerBg: "rgba(255,255,255,.95)",
        sidebarBg: "#fafbf9",
        composerBorder: "#dfe2de",
        sendBtn: "#2468d8",
        sendBtnText: "#ffffff",
        accent: "#2468d8",
        codeBg: "#f4f5f3",
        codeBorder: "#dde0db",
        reasoningBg: "#f4f6f9",
        reasoningBorder: "#dde2e6",
        hoverBg: "#f2f4f1",
        activeBg: "rgba(36,104,216,.08)",
        timeline: "#c4c8c2",
        sidebarBorder: "#e8ebe6",
        composerField: "#f9faf8",
        errorBg: "rgba(220,53,69,.06)",
        errorText: "#dc3545",
        disabledBtn: "#c4cad4",
        disabledBtnText: "#ffffff",
      } as const;
    }
    return {
      panelBg: "#151619",
      border: "#303136",
      text: "#f0f0f2",
      muted: "#9b9da5",
      inputBg: "#1d1e22",
      userBubble: "#292a2e",
      headerBg: "rgba(21,22,25,.95)",
      sidebarBg: "#111214",
      composerBorder: "#393b42",
      sendBtn: "#ededf0",
      sendBtnText: "#16171a",
      accent: "#7961ff",
      codeBg: "#0f1012",
      codeBorder: "#303136",
      reasoningBg: "#1a1b1f",
      reasoningBorder: "#303136",
      hoverBg: "#242529",
      activeBg: "rgba(121,97,255,.08)",
      timeline: "#4a4d55",
      sidebarBorder: "#26272b",
      composerField: "#191a1e",
      errorBg: "rgba(239,115,115,.08)",
      errorText: "#ef7373",
      disabledBtn: "#5c5e66",
      disabledBtnText: "#ffffff",
    } as const;
  }, [theme]);

  const [localCsrf, setLocalCsrf] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const thinkingStartRef = useRef<number>(0);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const [messageTimes, setMessageTimes] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ conversation: AiConversation; rect: DOMRect } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearInterval(thinkingTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const handler = () => setConfirmDelete(null);
    const id = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [confirmDelete]);

  const current = useMemo(() => conversations.find((item) => item.id === conversationId) ?? null, [conversations, conversationId]);

  const ensureSession = async () => {
    if (localCsrf) return localCsrf;
    const token = await requestLocalSession();
    if (mountedRef.current) setLocalCsrf(token);
    return token;
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const init = async () => {
      try { await ensureSession(); }
      catch { /* will show error in UI */ }
    };
    void init();
  }, []);

  const loadConversations = useCallback(
    async (showArchived = archived) => {
      const result = await getAiConversations(showArchived);
      if (!mountedRef.current) return;
      setConversations(result.items);
      const nextId = result.items.some((item) => item.id === conversationId) ? conversationId : result.items[0]?.id ?? null;
      setConversationId(nextId);
      if (!nextId) setMessages([]);
    },
    [conversationId, archived],
  );

  useEffect(() => {
    if (!localCsrf) return;
    loadConversations().catch((reason) => {
      if (mountedRef.current) setError(userFacingError(reason));
    });
  }, [localCsrf, loadConversations]);

  useEffect(() => {
    if (!conversationId || !localCsrf) return;
    let cancelled = false;
    getAiMessages(conversationId)
      .then((result) => { if (!cancelled && mountedRef.current) setMessages(result.items); })
      .catch((reason) => { if (!cancelled && mountedRef.current) setError(userFacingError(reason)); });
    return () => { cancelled = true; };
  }, [conversationId, localCsrf]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const createConversation = async () => {
    setBusy(true);
    setError("");
    try {
      const token = await ensureSession();
      const created = await createAiConversation(token);
      if (!mountedRef.current) return;
      setArchived(false);
      setConversations((items) => [created, ...items]);
      setConversationId(created.id);
      setMessages([]);
    } catch (reason) {
      if (mountedRef.current) setError(userFacingError(reason));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    try {
      const next = await readImages(files);
      if (mountedRef.current) setAttachments((items) => [...items, ...next].slice(0, 4));
    } catch (reason) {
      if (mountedRef.current) setError(userFacingError(reason));
    }
  };

  const sendStream = async () => {
    if (busy || (!draft.trim() && !attachments.length)) return;
    const trimmedDraft = draft.trim();
    const currentAttachments = [...attachments];
    setBusy(true);
    setError("");
    thinkingStartRef.current = Date.now();
    setThinkingElapsed(0);
    clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = setInterval(() => {
      if (thinkingStartRef.current) setThinkingElapsed(Math.floor((Date.now() - thinkingStartRef.current) / 1000));
    }, 1000);
    try {
      const token = await ensureSession();
      let id = conversationId;
      if (!id) {
        const created = await createAiConversation(token);
        if (!mountedRef.current) return;
        setConversations((items) => [created, ...items]);
        setConversationId(created.id);
        id = created.id;
      }
      const tempUserId = generateId();
      const optimisticUser: AiMessage = {
        id: tempUserId,
        role: "user",
        content: trimmedDraft || "Imagem enviada",
        reasoning: null,
        attachments: currentAttachments,
        createdAt: new Date().toISOString(),
      };
      setMessages((items) => [...items, optimisticUser]);
      setDraft("");
      setAttachments([]);

      const tempAssistantId = generateId();
      const optimisticAssistant: AiMessage = {
        id: tempAssistantId,
        role: "assistant",
        content: "",
        reasoning: "",
        attachments: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((items) => [...items, optimisticAssistant]);

      await sendAiMessageStream(token, id, { content: trimmedDraft, attachments: currentAttachments }, {
        onReasoning: (text) => {
          setMessages((items) => items.map((m) => (m.id === tempAssistantId ? { ...m, reasoning: (m.reasoning || "") + text } : m)));
        },
        onContent: (text) => {
          setMessages((items) => items.map((m) => (m.id === tempAssistantId ? { ...m, content: m.content + text } : m)));
        },
        onDone: (result) => {
          clearInterval(thinkingTimerRef.current);
          const finalElapsed = Math.floor((Date.now() - thinkingStartRef.current) / 1000);
          thinkingStartRef.current = 0;
          setMessages((items) =>
            items.map((m) => {
              if (m.id === tempUserId) return result.user;
              if (m.id === tempAssistantId) return result.assistant;
              return m;
            }),
          );
          setMessageTimes((prev) => ({ ...prev, [result.assistant.id]: finalElapsed }));
          setExpandedReasoning((prev) => {
            if (!prev.has(tempAssistantId)) return prev;
            const next = new Set(prev);
            next.delete(tempAssistantId);
            next.add(result.assistant.id);
            return next;
          });
          setConversations((items) =>
            items.map((item) =>
              item.id === id
                ? { ...item, title: result.title, messageCount: item.messageCount + 2, updatedAt: new Date().toISOString() }
                : item,
            ),
          );
          if (mountedRef.current) setBusy(false);
        },
        onError: (err) => {
          clearInterval(thinkingTimerRef.current);
          thinkingStartRef.current = 0;
          if (mountedRef.current) { setError(err); setBusy(false); }
        },
      });
    } catch (reason) {
      if (mountedRef.current) { setError(userFacingError(reason)); setBusy(false); }
    }
  };

  const changeArchive = async (conversation: AiConversation) => {
    try {
      const token = await ensureSession();
      await updateAiConversation(token, conversation.id, { archived: !conversation.archived });
      if (mountedRef.current) await loadConversations(archived);
    } catch (reason) {
      try {
        setLocalCsrf(null);
        const freshToken = await ensureSession();
        await updateAiConversation(freshToken, conversation.id, { archived: !conversation.archived });
        if (mountedRef.current) await loadConversations(archived);
      } catch (retryReason) {
        if (mountedRef.current) setError(userFacingError(retryReason));
      }
    }
  };

  const removeConversation = async (conversation: AiConversation) => {
    try {
      const token = await ensureSession();
      await deleteAiConversation(token, conversation.id);
      if (mountedRef.current) await loadConversations(archived);
    } catch (reason) {
      try {
        setLocalCsrf(null);
        const freshToken = await ensureSession();
        await deleteAiConversation(freshToken, conversation.id);
        if (mountedRef.current) await loadConversations(archived);
      } catch (retryReason) {
        if (mountedRef.current) setError(userFacingError(retryReason));
      }
    }
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void addFiles([...event.dataTransfer.files]);
  };

  const toggleReasoning = (messageId: string) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const panelFont = `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const composerEnabled = !busy && (!!draft.trim() || !!attachments.length);

  const formatInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    while (remaining.length) {
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
      const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/);

      let earliest: { type: string; prefix: string; content: string; end: number } | null = null;
      for (const m of [boldMatch, codeMatch, italicMatch]) {
        if (!m) continue;
        const idx = remaining.indexOf(m[0]);
        if (idx !== 0) continue; // only match at current position
        if (!earliest || m[0].length < (earliest.prefix + earliest.content).length) {
          earliest = { type: m === boldMatch ? "bold" : m === codeMatch ? "code" : "italic", prefix: m[1], content: m[2], end: m[0].length };
        }
      }
      if (!earliest) { parts.push(<span key={key++}>{remaining}</span>); break; }
      if (earliest.prefix) parts.push(<span key={key++}>{earliest.prefix}</span>);
      if (earliest.type === "bold") parts.push(<strong key={key++}>{earliest.content}</strong>);
      else if (earliest.type === "code") parts.push(<code key={key++} style={{ padding: "1px 4px", borderRadius: 3, background: colors.codeBg, border: `1px solid ${colors.codeBorder}`, fontSize: "0.92em" }}>{earliest.content}</code>);
      else parts.push(<em key={key++}>{earliest.content}</em>);
      remaining = remaining.slice(earliest.end);
    }
    return parts;
  };

  const FormattedMessage = ({ content }: { content: string }) => (
    <div>
      {content.split(/```/).map((block, blockIndex) =>
        blockIndex % 2 ? (
          <pre
            key={blockIndex}
            style={{
              margin: "8px 0",
              padding: "10px 12px",
              overflow: "auto",
              borderRadius: 8,
              background: colors.codeBg,
              border: `1px solid ${colors.codeBorder}`,
              fontSize: 11,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            <code>{block.replace(/^\w+\n/, "")}</code>
          </pre>
        ) : (
          <div key={blockIndex}>
            {block.split("\n").map((line, lineIndex) => {
              const key = `${blockIndex}-${lineIndex}`;
              if (/^###\s+/.test(line)) return <h4 key={key} style={{ margin: "10px 0 4px", fontSize: 12, fontWeight: 700, color: colors.text }}>{line.replace(/^###\s+/, "")}</h4>;
              if (/^##\s+/.test(line)) return <h3 key={key} style={{ margin: "12px 0 4px", fontSize: 14, fontWeight: 700, color: colors.text }}>{line.replace(/^##\s+/, "")}</h3>;
              if (/^#\s+/.test(line)) return <h2 key={key} style={{ margin: "14px 0 6px", fontSize: 15, fontWeight: 700, color: colors.text, borderBottom: `1px solid ${colors.border}`, paddingBottom: 4 }}>{line.replace(/^#\s+/, "")}</h2>;
              if (/^\*\*[^*]+\*\*$/.test(line.trim()))
                return <p key={key} style={{ margin: "8px 0 2px", fontWeight: 700, fontSize: 12, color: colors.text }}>{formatInline(line.trim().replace(/^\*\*|\*\*$/g, ""))}</p>;
              if (/^\*[^*]+\*$/.test(line.trim())) {
                const inner = line.trim().replace(/^\*|\*$/g, "");
                return <p key={key} style={{ margin: "6px 0 2px", fontWeight: 600, fontSize: 12, color: colors.text, fontStyle: "italic" }}>{formatInline(inner)}</p>;
              }
              if (/^\*\*[^*]+/.test(line.trim()) || /^\*[^*]+/.test(line.trim())) {
                const isBold = line.trim().startsWith("**");
                const stripped = line.trim().replace(/^\*\*?/, "");
                return <p key={key} style={{ margin: "6px 0 2px", fontWeight: 700, fontSize: 12, color: colors.text }}>{formatInline(stripped)}</p>;
              }
              if (/^[-*]\s+/.test(line))
                return (
                  <p key={key} style={{ margin: "2px 0", paddingLeft: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ flex: "0 0 auto", marginTop: 7, width: 4, height: 4, borderRadius: "50%", background: colors.accent }} />
                    {formatInline(line.replace(/^[-*]\s+/, ""))}
                  </p>
                );
              if (/^\d+\.\s+/.test(line))
                return (
                  <p key={key} style={{ margin: "2px 0", paddingLeft: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ flex: "0 0 auto", marginTop: 7, width: 4, height: 4, borderRadius: "50%", background: colors.accent }} />
                    {formatInline(line.replace(/^[-*]\s+/, ""))}
                  </p>
                );
              if (/^\d+\.\s+/.test(line))
                return (
                  <p key={key} style={{ margin: "2px 0", paddingLeft: 12, display: "flex", alignItems: "flex-start", gap: 4 }}>
                    <span style={{ flex: "0 0 auto", fontWeight: 700, fontSize: 11, minWidth: 14 }}>{line.match(/^\d+/)![0]}.</span>
                    {formatInline(line.replace(/^\d+\.\s+/, ""))}
                  </p>
                );
              return line.trim() ? <p key={key} style={{ margin: "2px 0", lineHeight: 1.6 }}>{formatInline(line)}</p> : <br key={key} />;
            })}
          </div>
        ),
      )}
    </div>
  );

  const isStreamingAssistant = busy && messages.length > 0 && messages[messages.length - 1]?.role === "assistant";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 75, pointerEvents: "none" }}>
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", opacity: 1, pointerEvents: "auto" }}
        onClick={onClose}
      />

      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: sidebarOpen ? "min(740px, 94vw)" : "min(460px, 94vw)",
          zIndex: 80,
          background: colors.panelBg,
          borderLeft: `1px solid ${colors.border}`,
          display: "flex",
          flexDirection: "row",
          fontFamily: panelFont,
          fontSize: 13,
          color: colors.text,
          pointerEvents: "auto",
          overflow: "hidden",
          transition: "width .25s cubic-bezier(.4,0,.2,1)",
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
      >
        <style>{`
          @keyframes ab-blink { 50% { opacity: 0; } }
          @keyframes ab-pulse { 50% { transform: scale(.86); opacity: .7; } }
          @keyframes ab-slide-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          .ab-spin { animation: spin 1s linear infinite; }
          .ab-reasoning-enter { animation: ab-slide-in .25s ease; }
          .ab-sidebar-item:hover .ab-sidebar-actions { opacity: 1 !important; }
          .ab-scroll::-webkit-scrollbar { width: 5px; }
          .ab-scroll::-webkit-scrollbar-track { background: transparent; }
          .ab-scroll::-webkit-scrollbar-thumb { background: ${theme === "dark" ? "#3a3c42" : "#ccd0cc"}; border-radius: 99px; }
          .ab-scroll::-webkit-scrollbar-thumb:hover { background: ${theme === "dark" ? "#4e5058" : "#b0b4b0"}; }
          .ab-scroll { scrollbar-width: thin; scrollbar-color: ${theme === "dark" ? "#3a3c42 transparent" : "#ccd0cc transparent"}; }
        `}</style>

        {/* Sidebar */}
        <div
          style={{
            width: sidebarOpen ? 240 : 0,
            flexShrink: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: colors.sidebarBg,
            borderRight: sidebarOpen ? `1px solid ${colors.sidebarBorder}` : "1px solid transparent",
            transition: "width .25s cubic-bezier(.4,0,.2,1), border-color .25s cubic-bezier(.4,0,.2,1)",
          }}
        >
          <div style={{ flex: "0 0 auto", padding: "12px 10px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 12, fontWeight: 600 }}>Conversas</strong>
            <button
              onClick={() => void createConversation()}
              title="Nova conversa"
              style={{ width: 28, height: 28, display: "grid", placeItems: "center", borderRadius: 7, border: 0, background: "transparent", color: colors.muted, cursor: "pointer" }}
            >
              <MessageSquarePlus size={14} />
            </button>
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", padding: "4px 6px 8px", gap: 2 }}>
            <button
              onClick={() => { setArchived(false); }}
              style={{
                flex: 1, height: 29, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: 0,
                background: !archived ? colors.hoverBg : "transparent",
                color: !archived ? colors.text : colors.muted,
                cursor: "pointer", fontSize: 10, fontWeight: !archived ? 500 : 400,
              }}
            >
              Recentes
            </button>
            <button
              onClick={() => { setArchived(true); }}
              style={{
                flex: 1, height: 29, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: 0,
                background: archived ? colors.hoverBg : "transparent",
                color: archived ? colors.text : colors.muted,
                cursor: "pointer", fontSize: 10, fontWeight: archived ? 500 : 400,
              }}
            >
              Arquivadas
            </button>
          </div>

          <div className="ab-scroll" style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="ab-sidebar-item"
                style={{
                  display: "flex", alignItems: "center", borderRadius: 7,
                  background: conv.id === conversationId ? colors.activeBg : "transparent",
                  borderLeft: conv.id === conversationId ? `2px solid ${colors.accent}` : "2px solid transparent",
                }}
              >
                <button
                  onClick={() => { setConversationId(conv.id); }}
                  style={{ flex: 1, minWidth: 0, padding: "7px 8px", display: "grid", gap: 1, textAlign: "left", border: 0, background: "transparent", color: colors.text, cursor: "pointer" }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 500 }}>{conv.title}</span>
                  <small style={{ color: colors.muted, fontSize: 9 }}>{conv.messageCount} mensagens · {formatConvDate(conv.updatedAt)}</small>
                </button>
                <div className="ab-sidebar-actions" style={{ flex: "0 0 auto", display: "flex", gap: 1, paddingRight: 3, opacity: 0, transition: "opacity .15s" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); void changeArchive(conv); }}
                    title={conv.archived ? "Reabrir" : "Arquivar"}
                    style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 5, border: 0, background: "transparent", color: colors.muted, cursor: "pointer" }}
                  >
                    {conv.archived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setConfirmDelete({ conversation: conv, rect }); }}
                    title="Apagar"
                    style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 5, border: 0, background: "transparent", color: colors.muted, cursor: "pointer" }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {!conversations.length && (
              <p style={{ padding: "14px 8px", margin: 0, color: colors.muted, fontSize: 10, textAlign: "center", lineHeight: 1.5 }}>
                Nenhuma conversa {archived ? "arquivada" : "iniciada"}.
              </p>
            )}
          </div>
        </div>

        {/* Main chat area */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          {/* Header gradient fade */}
          <div style={{
            position: "absolute", top: 56, left: 0, right: 0, height: 28, zIndex: 2,
            background: `linear-gradient(to bottom, ${colors.panelBg}, transparent)`,
            pointerEvents: "none",
          }} />
          {/* Header */}
          <div style={{
            flex: "0 0 auto", minHeight: 56, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            background: colors.headerBg,
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                title={sidebarOpen ? "Fechar conversas" : "Abrir conversas"}
                style={{ width: 29, height: 29, display: "grid", placeItems: "center", borderRadius: 7, border: 0, background: "transparent", color: colors.muted, cursor: "pointer", flex: "0 0 auto" }}
              >
                <Menu size={15} />
              </button>
              <img src="/alphabot.png" alt="AlphaBot" style={{ width: 26, height: 26, borderRadius: 7, flex: "0 0 auto" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto", background: localCsrf ? "#68d39a" : "#ef7373" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>AlphaBot</span>
                </div>
                <div style={{ color: colors.muted, fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Assistente do MarketSync</div>
              </div>
            </div>
            <button
              onClick={onClose}
              title="Fechar"
              style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 8, border: 0, background: "transparent", color: colors.muted, cursor: "pointer", flex: "0 0 auto" }}
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="ab-scroll" style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 14 }}>
            {!messages.length && !busy && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
                <img src="/alphabot.png" alt="AlphaBot" style={{ width: 72, height: 72, borderRadius: 18 }} />
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Olá! Como posso ajudar?</h3>
                <p style={{ margin: 0, color: colors.muted, fontSize: 11, lineHeight: 1.55, maxWidth: 280 }}>
                  Pergunte sobre o MarketSync, anúncios, catálogo, Pix, integrações, ou qualquer outra dúvida que você tenha. 
                </p>
              </div>
            )}

            {messages.map((item) => (
              <div key={item.id} style={{ display: "flex", gap: 9, flexDirection: item.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
                {item.role === "assistant" && (
                  <img src="/alphabot.png" alt="AlphaBot" style={{ width: 28, height: 28, borderRadius: 7, flex: "0 0 auto" }} />
                )}
                <div style={{ minWidth: 0, flex: item.role === "user" ? "0 1 auto" : "1 1 auto", maxWidth: item.role === "user" ? "82%" : "100%" }}>
                  <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6, justifyContent: item.role === "user" ? "flex-end" : "flex-start" }}>
                    <strong style={{ fontSize: 10, fontWeight: 600 }}>{item.role === "assistant" ? "AlphaBot" : "Você"}</strong>
                    <time style={{ color: colors.muted, fontSize: 8 }}>{new Date(item.createdAt).toLocaleString("pt-BR")}</time>
                  </div>

                  {item.attachments?.length > 0 && (
                    <div style={{ marginBottom: 7, display: "grid", gridTemplateColumns: `repeat(${Math.min(item.attachments.length, 2)}, minmax(0, 160px))`, justifyContent: item.role === "user" ? "end" : "start", gap: 6 }}>
                      {item.attachments.map((attachment, idx) => (
                        <div key={`${attachment.name}-${idx}`} style={{ overflow: "hidden", borderRadius: 9, border: `1px solid ${colors.border}`, background: colors.panelBg }}>
                          <a href={attachment.dataUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                            <img src={attachment.dataUrl} alt={attachment.name} style={{ width: "100%", aspectRatio: "1.55", display: "block", objectFit: "cover", background: theme === "dark" ? "#0d0e10" : "#eef0ee" }} />
                          </a>
                          <span style={{ display: "block", padding: "5px 7px", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(item.reasoning || (isStreamingAssistant && item.id === messages[messages.length - 1]?.id)) && item.role === "assistant" && (
                    <button
                      onClick={() => toggleReasoning(item.id)}
                      style={{
                        marginBottom: 6, padding: "6px 9px", display: "inline-flex", alignItems: "center", gap: 7,
                        border: `1px solid ${colors.reasoningBorder}`, borderRadius: 8,
                        background: colors.reasoningBg, color: colors.text,
                        cursor: "pointer", fontSize: 10,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
                        <path d="M4.3 5.6A3.6 3.6 0 0 1 7.9 2h6.6a3.6 3.6 0 0 1 3.6 3.6v3.8a3.6 3.6 0 0 1-3.6 3.6h-3.8l-3.45 2.55.62-2.55A3.6 3.6 0 0 1 4.3 9.4V5.6Z" />
                        <path d="M14.3 15.2h2.2a3.2 3.2 0 0 0 3.2-3.2V9.9a3.25 3.25 0 0 1 1 2.35v2.15a3.2 3.2 0 0 1-3.2 3.2h-.35l.42 2.15-2.55-2.15h-.72" />
                      </svg>
                      <span>Raciocínio</span>
                      {isStreamingAssistant && item.id === messages[messages.length - 1]?.id && (
                        <span style={{ color: colors.muted, fontSize: 9, fontWeight: 400 }}>
                          {Math.floor(thinkingElapsed / 60)}m {String(thinkingElapsed % 60).padStart(2, "0")}s
                        </span>
                      )}
                      {!isStreamingAssistant && item.reasoning && messageTimes[item.id] != null && (
                        <span style={{ color: colors.muted, fontSize: 9, fontWeight: 400 }}>
                          {messageTimes[item.id] < 60 ? `${messageTimes[item.id]}s` : `${Math.floor(messageTimes[item.id] / 60)}m ${String(messageTimes[item.id] % 60).padStart(2, "0")}s`}
                        </span>
                      )}
                      {!isStreamingAssistant && item.reasoning && messageTimes[item.id] == null && (
                        <span style={{ color: colors.muted, fontSize: 9, fontWeight: 400 }}>
                          {item.reasoning.length > 800 ? `${Math.round(item.reasoning.length / 100) / 10}k` : `${item.reasoning.length} car.`}
                        </span>
                      )}
                      <ChevronDown size={12} style={{ transition: "transform .2s", transform: expandedReasoning.has(item.id) ? "rotate(180deg)" : undefined }} />
                    </button>
                  )}

                  {item.reasoning && expandedReasoning.has(item.id) && (
                    <div className="ab-reasoning-enter" style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 8, border: `1px solid ${colors.reasoningBorder}`, background: colors.reasoningBg, fontSize: 10, lineHeight: 1.55, color: theme === "dark" ? "#cfd0d5" : "#4a5568" }}>
                      <div style={{ marginBottom: 5, fontWeight: 600, fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>Raciocínio do AlphaBot</div>
                      <FormattedMessage content={item.reasoning} />
                    </div>
                  )}

                  <div
                    style={item.role === "user" ? {
                      padding: "9px 12px",
                      borderRadius: "14px 14px 4px 14px",
                      background: colors.userBubble,
                      lineHeight: 1.55,
                      fontSize: 12,
                      width: "fit-content",
                      maxWidth: "100%",
                      marginLeft: "auto",
                    } : {
                      lineHeight: 1.65,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    <FormattedMessage content={item.content} />
                  </div>
                </div>
              </div>
            ))}

            {busy && !isStreamingAssistant && (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <img src="/alphabot.png" alt="AlphaBot" style={{ width: 28, height: 28, borderRadius: 7, flex: "0 0 auto" }} />
                <div>
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ fontSize: 10, fontWeight: 600 }}>AlphaBot</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, color: colors.muted, fontSize: 11 }}>
                    <svg className="ab-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    Organizando a resposta...
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: theme === "dark" ? "#d8d8dd" : "#687381", animation: "ab-blink .8s steps(2, end) infinite" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Error bar */}
          {error && (
            <div style={{ flex: "0 0 auto", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${colors.errorText}22`, background: colors.errorBg, color: colors.errorText, fontSize: 10, lineHeight: 1.45 }}>
              <span>{error}</span>
              <button onClick={() => setError("")} style={{ width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 5, border: 0, background: "transparent", color: colors.errorText, cursor: "pointer" }}>
                <X size={12} />
              </button>
            </div>
          )}

          {/* Composer */}
          <div style={{ flex: "0 0 auto", padding: "10px 10px 10px", background: theme === "dark" ? "linear-gradient(to top, #151619 72%, transparent)" : "linear-gradient(to top, #ffffff 72%, transparent)" }}>
            {attachments.length > 0 && (
              <div style={{ marginBottom: 6, display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {attachments.map((attachment, index) => (
                  <div key={`${attachment.name}-${index}`} style={{ minWidth: 170, padding: 5, display: "flex", alignItems: "center", gap: 6, borderRadius: 9, border: `1px solid ${colors.border}`, background: colors.inputBg }}>
                    <img src={attachment.dataUrl} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flex: "0 0 auto" }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: "block", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.name}</strong>
                      <small style={{ color: colors.muted, fontSize: 8 }}>{(attachment.dataUrl.length * 0.75 / 1024).toFixed(0)} KB</small>
                    </div>
                    <button
                      onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}
                      style={{ width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: 5, border: 0, background: "transparent", color: colors.muted, cursor: "pointer", flex: "0 0 auto" }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: "6px 6px 6px 10px", display: "flex", alignItems: "flex-end", gap: 5, borderRadius: 14, border: `1px solid ${colors.composerBorder}`, background: colors.composerField }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={paste}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendStream(); } }}
                placeholder="Pergunte algo sobre o MarketSync..."
                rows={1}
                style={{ flex: 1, minHeight: 30, maxHeight: 130, padding: "4px 2px 2px", resize: "none", border: 0, outline: 0, background: "transparent", color: colors.text, lineHeight: 1.45, fontSize: 12, fontFamily: "inherit" }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                title="Anexar imagens"
                style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: 0, background: "transparent", color: colors.muted, cursor: "pointer", flex: "0 0 auto" }}
              >
                <ImagePlus size={16} />
              </button>
              <button
                onClick={() => void sendStream()}
                disabled={!composerEnabled}
                title="Enviar"
                style={{
                  width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: 0, cursor: "pointer", flex: "0 0 auto",
                  background: composerEnabled ? colors.sendBtn : colors.disabledBtn,
                  color: composerEnabled ? colors.sendBtnText : colors.disabledBtnText,
                  opacity: composerEnabled ? 1 : .55,
                }}
              >
                <Send size={14} />
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => { if (e.target.files) { void addFiles(e.target.files); e.target.value = ""; } }}
            />

            <p style={{ margin: "5px 0 0", textAlign: "center", color: colors.muted, fontSize: 8 }}>
              AlphaBot pode cometer erros. Verifique as informações.
            </p>
          </div>
        </div>
      </div>

      {/* Confirm delete popover */}
      {confirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: confirmDelete.rect.bottom + 4,
            left: Math.min(confirmDelete.rect.left, window.innerWidth - 240),
            zIndex: 200,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.panelBg,
            boxShadow: "0 4px 16px rgba(0,0,0,.25)",
            fontSize: 11,
            color: colors.text,
            maxWidth: 220,
          }}
        >
          <p style={{ margin: "0 0 8px", lineHeight: 1.4 }}>Apagar "{confirmDelete.conversation.title}"?</p>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              onClick={() => setConfirmDelete(null)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: "transparent",
                color: colors.text,
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => { removeConversation(confirmDelete.conversation); setConfirmDelete(null); }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: 0,
                background: colors.errorText,
                color: "#ffffff",
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              Apagar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
