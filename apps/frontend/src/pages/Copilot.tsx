import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Bot, Send, Sparkles, Shield, Cpu, Sliders, RefreshCw, 
  Terminal, CheckCircle2, AlertCircle, ArrowRight, Zap, Info, Lock
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  source?: string;
  model?: string;
  action?: {
    action_type: string;
    camera_id?: string;
    prompt?: string;
  } | null;
}

interface CopilotConfig {
  provider: string;
  has_openai_key: boolean;
  has_nim_key: boolean;
  openai_model: string;
  nim_model: string;
  ollama_model: string;
  ollama_url: string;
  offline_brain_ready: boolean;
}

export const Copilot: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content: 
        "### 🛡️ IBVAP Tactical AI Copilot Initialized\n\n" +
        "I am your autonomous border surveillance intelligence assistant, trained on **BSF Border Defense SOPs**, **YOLOv8/ByteTrack/TensorRT architectures**, and **real-time outpost telemetry**.\n\n" +
        "You can ask me operational questions, query live cameras and vehicles, request threat assessments, or execute system commands.",
      timestamp: new Date().toLocaleTimeString(),
      source: 'local_tactical_engine',
      model: 'ibvap_tactical_brain_v2'
    }
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<CopilotConfig | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  // Config Modal State
  const [selectedProvider, setSelectedProvider] = useState('offline');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatusMsg, setConfigStatusMsg] = useState('');

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const fetchConfig = async () => {
    try {
      const res = await axios.get('/api/v1/copilot/config');
      setConfig(res.data);
      setSelectedProvider(res.data.provider || 'offline');
    } catch (err) {
      console.error('Failed to load copilot config', err);
    }
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigStatusMsg('');
    try {
      await axios.post('/api/v1/copilot/config', {
        provider: selectedProvider,
        api_key: apiKeyInput ? apiKeyInput : undefined,
        model: modelInput ? modelInput : undefined
      });
      setConfigStatusMsg('Configuration saved successfully!');
      fetchConfig();
      setTimeout(() => {
        setShowConfigModal(false);
        setConfigStatusMsg('');
      }, 1200);
    } catch (err: any) {
      setConfigStatusMsg(`Failed: ${err.message || 'Error saving settings'}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!queryText) setInputQuery('');
    setIsLoading(true);

    try {
      // Build messages payload
      const historyPayload = messages
        .filter((m) => m.id !== 'welcome-msg')
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await axios.post('/api/v1/copilot/chat', {
        messages: historyPayload,
        camera_id: 'CAM-01'
      });

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: res.data.reply || 'No response generated.',
        timestamp: new Date().toLocaleTimeString(),
        source: res.data.source,
        model: res.data.model,
        action: res.data.action
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **Error contacting AI Copilot**: ${err.response?.data?.detail || err.message}. Falling back to local sensors.`,
        timestamp: new Date().toLocaleTimeString(),
        source: 'error'
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteAction = async (action: { action_type: string; camera_id?: string }) => {
    if (action.action_type === 'switch_camera' && action.camera_id) {
      try {
        await axios.post(`/api/v1/cameras/${action.camera_id}/activate`);
        const confirmMsg: ChatMessage = {
          id: `sys-${Date.now()}`,
          role: 'assistant',
          content: `✅ **Action Executed**: Successfully switched active inference worker to **${action.camera_id}**. Live video pipeline and GPU tracker updated.`,
          timestamp: new Date().toLocaleTimeString(),
          source: 'system_executor'
        };
        setMessages((prev) => [...prev, confirmMsg]);
      } catch (err: any) {
        alert(`Failed to activate camera: ${err.message}`);
      }
    }
  };

  const quickPrompts = [
    { label: '🛡️ Generate SITREP', text: 'Generate a tactical situation report (SITREP) of recent perimeter activity.' },
    { label: '🌙 Night Intrusion SOP', text: 'What is the standard operating procedure for a night perimeter breach?' },
    { label: '🛸 Anti-Drone Protocol', text: 'What is the SOP for low-altitude UAV or drone intrusion?' },
    { label: '⚡ GPU & Telemetry', text: 'Check GPU, VRAM, and edge station hardware telemetry.' },
    { label: '🚚 Trucks & ANPR Audit', text: 'Are there any trucks or vehicles registered in memory?' },
    { label: '🧠 Explain ByteTrack', text: 'Explain how ByteTrack and TensorRT FP16 acceleration operate.' },
    { label: '🎯 Switch to Webcam', text: 'Please switch to webcam' },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4 flex items-center justify-between shadow-lg text-white">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg">
            <Bot size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">Tactical AI Copilot</h1>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Military-Grade Border Defense Intelligence & Conversational Assistant
            </p>
          </div>
        </div>

        {/* Right Info & Config Controls */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700 text-xs">
            <Cpu size={14} className="text-cyan-400" />
            <span className="text-slate-300">Brain:</span>
            <span className="font-semibold text-cyan-300 uppercase">
              {config?.provider === 'openai' ? 'OpenAI ChatGPT' : config?.provider === 'nvidia_nim' ? 'NVIDIA NIM' : config?.provider === 'ollama' ? 'Local Ollama' : 'Offline Tactical'}
            </span>
          </div>

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-medium text-slate-200 transition-colors"
          >
            <Sliders size={14} />
            Configure Brain
          </button>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 overflow-y-auto shadow-sm flex flex-col space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3.5 max-w-3xl ${
              msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-blue-400 border border-slate-800'
              }`}
            >
              {msg.role === 'user' ? <Shield size={18} /> : <Bot size={18} />}
            </div>

            <div
              className={`rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-none'
              }`}
            >
              {/* Message Header info for AI */}
              {msg.role === 'assistant' && (
                <div className="flex items-center justify-between text-xs text-slate-400 pb-2 mb-2 border-b border-slate-200">
                  <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-amber-500" />
                    Tactical Commander AI
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {msg.source ? `[${msg.source}]` : ''} {msg.timestamp}
                  </span>
                </div>
              )}

              {/* Render formatted content */}
              <div className="space-y-2 whitespace-pre-wrap font-sans">
                {msg.content}
              </div>

              {/* Action Proposal Button */}
              {msg.action && (
                <div className="mt-3.5 pt-3 border-t border-slate-200">
                  <button
                    onClick={() => handleExecuteAction(msg.action!)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow transition-colors"
                  >
                    <Zap size={14} />
                    Execute Action: {msg.action.camera_id || msg.action.action_type}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start gap-3.5 max-w-xl mr-auto">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-blue-400 border border-slate-800 flex items-center justify-center shrink-0 shadow-sm animate-pulse">
              <Bot size={18} />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-none px-5 py-4 text-xs text-slate-500 flex items-center gap-2 shadow-sm">
              <RefreshCw size={14} className="animate-spin text-blue-600" />
              <span>Analyzing tactical sensors & formulating response...</span>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Quick Prompt Chips */}
      <div className="py-2.5 flex items-center gap-2 overflow-x-auto text-xs scrollbar-none">
        <span className="text-slate-500 font-medium text-[11px] uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Terminal size={12} /> Prompt Chips:
        </span>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(p.text)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg shrink-0 border border-slate-300 font-medium transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-2.5 shadow-sm flex items-center gap-2">
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="Ask tactical question (e.g. 'What is the drone SOP?' or 'Check GPU status' or 'Switch to webcam')..."
          className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
        />
        <button
          onClick={() => handleSend()}
          disabled={!inputQuery.trim() || isLoading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <Send size={14} />
          <span>Send</span>
        </button>
      </div>

      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sliders size={18} className="text-blue-400" />
                <h3 className="font-bold text-base">Configure AI Intelligence Brain</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 py-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Select Intelligence Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="offline">Autonomous Offline Tactical Brain (Recommended & Air-Gapped)</option>
                  <option value="openai">OpenAI ChatGPT (GPT-4o / GPT-4o-mini)</option>
                  <option value="nvidia_nim">NVIDIA NIM (Llama-3.3-70B-Instruct)</option>
                  <option value="ollama">Local Ollama (Llama 3.2 / Phi-3)</option>
                </select>
                <p className="text-slate-400 text-[11px] mt-1">
                  Offline mode uses embedded military SOPs and live sensor reasoning without external cloud requests.
                </p>
              </div>

              {selectedProvider === 'openai' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">OpenAI API Key</label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="mt-2">
                    <label className="block text-slate-300 font-semibold mb-1">Model Name</label>
                    <input
                      type="text"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      placeholder="gpt-4o-mini or gpt-4o"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedProvider === 'nvidia_nim' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">NVIDIA NIM API Key</label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="nvapi-..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {configStatusMsg && (
                <div className={`p-2.5 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  configStatusMsg.includes('Failed') ? 'bg-red-900/40 text-red-300 border border-red-800' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
                }`}>
                  {configStatusMsg.includes('Failed') ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  <span>{configStatusMsg}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                {configSaving && <RefreshCw size={12} className="animate-spin" />}
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
