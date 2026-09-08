import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Bot, X, Send, Sparkles, RefreshCw, Zap, ArrowRight, Shield } from 'lucide-react';

export const FloatingCopilot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    action?: { action_type: string; camera_id?: string } | null;
  }>>([
    {
      role: 'assistant',
      content: 'Tactical AI Copilot ready. Ask me anything about cameras, border SOPs, or threat alerts.'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    const newMsgs = [...messages, { role: 'user' as const, content: text }];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const res = await axios.post('/api/v1/copilot/chat', {
        messages: newMsgs.map((m) => ({ role: m.role, content: m.content })),
        camera_id: 'CAM-01'
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.data.reply || 'Analysis complete.',
          action: res.data.action
        }
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Failed to reach copilot: ${err.message}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = async (action: { action_type: string; camera_id?: string }) => {
    if (action.action_type === 'switch_camera' && action.camera_id) {
      try {
        await axios.post(`/api/v1/cameras/${action.camera_id}/activate`);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `✅ Switched active camera to ${action.camera_id}.`
          }
        ]);
      } catch (err: any) {
        alert(`Action failed: ${err.message}`);
      }
    }
  };

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 p-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl flex items-center gap-2 transition-transform hover:scale-105 group border border-blue-400/30"
          title="Open Tactical AI Copilot"
        >
          <Bot size={22} />
          <span className="text-xs font-bold pr-1 hidden group-hover:inline transition-all">
            AI Copilot
          </span>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 absolute top-1 right-1 border-2 border-slate-900 animate-pulse"></span>
        </button>
      )}

      {/* Floating Chat Drawer */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] h-[520px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white">
          {/* Header */}
          <div className="p-3.5 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
                <Bot size={18} />
              </div>
              <div>
                <h4 className="font-bold text-xs">Tactical AI Copilot</h4>
                <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>Autonomous Brain Active</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 text-xs"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages Body */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs bg-slate-950">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-md bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={12} />
                  </div>
                )}
                <div
                  className={`rounded-xl px-3 py-2 max-w-[85%] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none'
                      : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.action && (
                    <div className="mt-2 pt-2 border-t border-slate-700">
                      <button
                        onClick={() => handleExecuteAction(m.action!)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded shadow transition-colors"
                      >
                        <Zap size={11} />
                        Activate {m.action.camera_id}
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-1">
                <RefreshCw size={12} className="animate-spin text-blue-400" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          {/* Input Footer */}
          <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              placeholder="Ask tactical question..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
