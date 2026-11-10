"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, streamCompletion } from "@/lib/api/client";

interface Msg {
  id: string;
  role: string;
  content: string;
}

export function ChatPanel({
  botId,
  welcome,
  ragHint,
}: {
  botId: string;
  welcome?: string;
  ragHint?: boolean;
}) {
  const qc = useQueryClient();
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const newConv = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/bots/{bot_id}/conversations",
        { params: { path: { bot_id: botId } }, body: { title: "新会话" } },
      );
      if (error) throw error;
      return data.data;
    },
    onSuccess: (conv) => {
      setConvId(conv.id);
      setMessages([]);
      qc.invalidateQueries({ queryKey: ["bot", botId] });
    },
  });

  useEffect(() => {
    if (botId) newConv.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!convId || !input.trim() || streaming) return;
    const userText = input.trim();
    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: userText }]);
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      await streamCompletion(convId, userText, (delta) => {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg,
          ),
        );
      });
    } catch {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: msg.content || "（生成失败，请检查后端配置）" }
            : msg,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">
            {welcome || "开始对话吧。"}
            {ragHint ? "（已接知识库 · Agentic RAG）" : ""}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "user" ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.content || "…"}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mx-auto flex w-full max-w-3xl gap-2 border-t border-border p-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息…"
          disabled={!convId || streaming}
          className="flex-1"
        />
        <Button type="submit" disabled={!convId || streaming}>
          {streaming ? "生成中…" : "发送"}
        </Button>
      </form>
    </div>
  );
}
