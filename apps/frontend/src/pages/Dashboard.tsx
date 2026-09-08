import React, { useState, useEffect, useRef } from 'react';
import { useCameras, useIncidents, useAcknowledgeIncident, useANPRObservations } from '../api/hooks';
import { useWebSocketHub, WebSocketAlert, WebSocketANPREvent, TelemetryMessage } from '../api/useWebSocketAlerts';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { 
  Shield, 
  ShieldAlert, 
  CheckCircle, 
  Video, 
  Radio, 
  AlertTriangle, 
  Cpu, 
  Activity, 
  Layers, 
  Eye, 
  Clock,
  Maximize2,
  Car,
  Bot,
  Sparkles,
  Send,
  Terminal,
  X,
  Loader2,
  MessageSquare,
  Smartphone,
  Wifi,
  Target
} from 'lucide-react';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { OperatorFeedbackModal } from '../components/OperatorFeedbackModal';
import { Incident } from '../types';

interface ZonePoint {
  x: number;
  y: number;
}

interface ZoneConfig {
  zone_id: string;
  name: string;
  camera_id: string;
  zone_type: string;
  color: string;
  points: ZonePoint[];
}

const SeverityBadge = ({ severity }: { severity: string }) => {
  const colors = {
    INFO: 'bg-slate-100 text-slate-700',
    LOW: 'bg-yellow-100 text-yellow-800',
    MEDIUM: 'bg-orange-100 text-orange-800',
    HIGH: 'bg-red-100 text-red-800 border border-red-200',
    CRITICAL: 'bg-red-600 text-white animate-pulse shadow-sm',
  };
  
  return (
    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${colors[severity as keyof typeof colors] || colors.INFO}`}>
      {severity}
    </span>
  );
};

export const Dashboard = () => {
  const queryClient = useQueryClient();
  const { data: cameras, isLoading: camLoading } = useCameras();
  const { data: incidents, isLoading: incLoading } = useIncidents(15, false);
  const { data: anprRecords, isLoading: anprLoading } = useANPRObservations(15);
  const { mutate: acknowledge } = useAcknowledgeIncident();

  const [liveBanner, setLiveBanner] = useState<WebSocketAlert | null>(null);
  const [liveANPRBanner, setLiveANPRBanner] = useState<WebSocketANPREvent | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryMessage | null>(null);
  const [zones, setZones] = useState<ZoneConfig[]>([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    const saved = localStorage.getItem('ibvap_selected_camera');
    return (saved && saved !== 'CAM-01') ? saved : 'PHONE-CAM-01';
  });
  const [phoneUrl, setPhoneUrl] = useState('');
  const [phoneConnecting, setPhoneConnecting] = useState(false);
  const [phoneStatus, setPhoneStatus] = useState<{ msg: string; success?: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/v1/system/settings')
      .then(r => r.json())
      .then(data => {
        if (data.phone_camera_url) {
          setPhoneUrl(data.phone_camera_url);
        }
      })
      .catch(() => {});
  }, []);

  const handleConnectPhone = async (overrideUrl?: string) => {
    const target = (overrideUrl || phoneUrl).trim();
    if (!target) {
      setPhoneStatus({ msg: 'Please enter phone IP or URL', success: false });
      return;
    }
    setPhoneConnecting(true);
    setPhoneStatus({ msg: 'Connecting phone camera...', success: true });
    try {
      const res = await fetch('/api/v1/cameras/phone/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target })
      });
      const data = await res.json();
      if (res.ok) {
        setPhoneStatus({ msg: `Connected! Stream active at ${data.stream_url}`, success: true });
        setSelectedCameraId('PHONE-CAM-01');
        try {
          localStorage.setItem('ibvap_selected_camera', 'PHONE-CAM-01');
        } catch {}
        if (data.stream_url) setPhoneUrl(data.stream_url);
      } else {
        setPhoneStatus({ msg: `Connection failed: ${data.detail || 'Error'}`, success: false });
      }
    } catch (err: any) {
      setPhoneStatus({ msg: `Connection error: ${err.message}`, success: false });
    } finally {
      setPhoneConnecting(false);
    }
  };

  const applyPreset = (preset: 'ipwebcam' | 'droidcam') => {
    let host = '192.168.1.5';
    const match = phoneUrl.match(/(?:https?:\/\/)?([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
    if (match && match[1]) {
      host = match[1];
    }
    const newUrl = preset === 'ipwebcam' ? `http://${host}:8080/video` : `http://${host}:4747/video`;
    setPhoneUrl(newUrl);
    handleConnectPhone(newUrl);
  };
  const [activeSideTab, setActiveSideTab] = useState<'incidents' | 'detections' | 'remembrance'>('detections');
  const [remembranceProfiles, setRemembranceProfiles] = useState<any[]>([]);
  const [feedbackIncident, setFeedbackIncident] = useState<Incident | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  useEffect(() => {
    if (activeSideTab !== 'remembrance') return;
    const fetchRemembrance = () => {
      fetch('/api/v1/tracking/remembrance')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setRemembranceProfiles(data);
        })
        .catch(() => {});
    };
    fetchRemembrance();
    const interval = setInterval(fetchRemembrance, 5000);
    return () => clearInterval(interval);
  }, [activeSideTab]);

  // Tactical AI Copilot State
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotQuery, setCopilotQuery] = useState('');
  const [copilotHistory, setCopilotHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; source?: string; threat?: string }>>([
    {
      role: 'assistant',
      text: 'IBVAP Tactical AI Copilot initialized. Ready for operational intelligence queries or shift situation reports (SITREP).',
      source: 'NVIDIA NIM / Tactical Defense Engine'
    }
  ]);

  const handleSendCopilotQuery = async (queryText?: string) => {
    const text = (queryText || copilotQuery).trim();
    if (!text) return;
    setCopilotQuery('');
    setCopilotHistory(prev => [...prev, { role: 'user', text }]);
    setCopilotLoading(true);

    try {
      const res = await fetch('/api/v1/copilot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, camera_id: selectedCameraId })
      });
      const data = await res.json();
      setCopilotHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer || 'Query processed.',
          source: data.source === 'nvidia_nim' ? 'NVIDIA NIM (Llama-3.2-Vision)' : 'Local Tactical Engine'
        }
      ]);
    } catch (err: any) {
      setCopilotHistory(prev => [
        ...prev,
        { role: 'assistant', text: `Failed to query tactical agent: ${err.message}` }
      ]);
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleGenerateSITREP = async () => {
    setCopilotLoading(true);
    setCopilotHistory(prev => [...prev, { role: 'user', text: 'Generate Tactical Shift SITREP' }]);

    try {
      const res = await fetch('/api/v1/copilot/sitrep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shift_notes: `Active monitoring on ${selectedCameraId}` })
      });
      const data = await res.json();
      setCopilotHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          text: data.briefing || 'SITREP completed.',
          threat: data.threat_level,
          source: data.source === 'nvidia_nim' ? 'NVIDIA NIM (Llama-3.2-Vision)' : 'Local Tactical Engine'
        }
      ]);
    } catch (err: any) {
      setCopilotHistory(prev => [
        ...prev,
        { role: 'assistant', text: `SITREP generation error: ${err.message}` }
      ]);
    } finally {
      setCopilotLoading(false);
    }
  };

  // Handle switching cameras and notifying backend worker
  const handleSelectCamera = async (cameraId: string) => {
    setSelectedCameraId(cameraId);
    try {
      localStorage.setItem('ibvap_selected_camera', cameraId);
    } catch {}
    try {
      await fetch(`/api/v1/cameras/${cameraId}/activate`, { method: 'POST' });
    } catch (e) {
      console.warn("Failed to notify backend camera activation:", e);
    }
  };

  // Activate selected camera on page load
  useEffect(() => {
    const saved = localStorage.getItem('ibvap_selected_camera');
    const initialCam = (saved && saved !== 'CAM-01') ? saved : 'PHONE-CAM-01';
    handleSelectCamera(initialCam);
  }, []);


  // Fetch authoritative zones from backend
  useEffect(() => {
    fetch('/api/v1/zones')
      .then(res => res.json())
      .then(data => {
        if (data.zones) setZones(data.zones);
      })
      .catch(() => {});
  }, []);

  // Connect to live WebSocket telemetry & alerts with throttled rendering
  const lastTelemetryUpdateRef = useRef<number>(0);
  const { isConnected, connectionStatus } = useWebSocketHub(
    (alert) => {
      setLiveBanner(alert);
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
    (tel) => {
      const now = performance.now();
      // Throttle UI re-renders to 4 FPS (every 250ms) to eliminate browser thread lag
      if (now - lastTelemetryUpdateRef.current >= 250) {
        lastTelemetryUpdateRef.current = now;
        setTelemetry(tel);
      }
    },
    (anpr) => {
      setLiveANPRBanner(anpr);
      queryClient.invalidateQueries({ queryKey: ['anpr_observations'] });
    }
  );

  const activeIncidents = incidents?.filter(i => !i.acknowledged).length || 0;
  const metrics = telemetry?.metrics;

  // Expose clean test/debug state for automated browser acceptance tests
  useEffect(() => {
    (window as any).__IBVAP_TEST_STATE__ = {
      videoPlaying: true,
      activeTracks: telemetry?.tracks?.length || 0,
      tracks: telemetry?.tracks || [],
      detections: telemetry?.tracks?.map(t => ({ 
        class_name: t.class_name, 
        subclass: t.subclass,
        confidence: t.confidence, 
        bbox: t.bbox,
        plate_text: t.plate_text,
        plate_confidence: t.plate_confidence,
        plate_status: t.plate_status
      })) || [],
      vehicleTracks: telemetry?.tracks?.filter(t => t.class_name === 'vehicle') || [],
      latestAlerts: liveBanner ? [liveBanner] : [],
      latestANPR: liveANPRBanner,
      cameraStatus: metrics?.camera_health || 'ONLINE',
      websocketStatus: connectionStatus,
      fps: metrics?.fps || 0,
      zones: zones.map(z => z.zone_id)
    };
  }, [telemetry, liveBanner, liveANPRBanner, metrics, connectionStatus, zones]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Real-time Zone Breach Alert Banner */}
      {liveBanner && (
        <div className="bg-red-600 text-white p-4 rounded-xl shadow-xl flex items-center justify-between animate-pulse border-2 border-red-400">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-yellow-300 animate-bounce" size={28} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-extrabold text-sm tracking-wide uppercase">
                  {liveBanner.event_type === 'DIRECTION_VIOLATION' && '🧭 DIRECTION VIOLATION'}
                  {liveBanner.event_type === 'LOITERING' && '⏳ LOITERING DETECTED'}
                  {liveBanner.event_type === 'NIGHT_MOVEMENT' && '🌙 NIGHT MOVEMENT CURFEW BREACH'}
                  {liveBanner.event_type === 'REPEATED_ENTRY' && '🔁 REPEATED ENTRY (RECONNAISSANCE)'}
                  {!['DIRECTION_VIOLATION', 'LOITERING', 'NIGHT_MOVEMENT', 'REPEATED_ENTRY'].includes(liveBanner.event_type) && `🚨 ${liveBanner.event_type.replace(/_/g, ' ')}`}
                  {' — '}{liveBanner.camera_id}
                </p>
                <span className="bg-red-800 text-white text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                  {liveBanner.severity}
                </span>
              </div>
              <p className="text-xs text-red-100 font-medium mt-0.5">{liveBanner.explanation}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFeedbackIncident({
                  id: liveBanner.incident_id,
                  camera_id: liveBanner.camera_id,
                  timestamp: liveBanner.timestamp,
                  event_type: liveBanner.event_type,
                  severity: (liveBanner.severity as any) || 'HIGH',
                  confidence: liveBanner.confidence,
                  explanation: liveBanner.explanation,
                  evidence_reference: liveBanner.evidence_url,
                  sha256: liveBanner.sha256,
                  acknowledged: false
                });
                setIsFeedbackOpen(true);
              }}
              className="text-xs font-semibold bg-white text-red-700 hover:bg-red-50 px-3 py-1.5 rounded transition-colors shadow-sm cursor-pointer"
            >
              Operator Feedback
            </button>
            <button 
              onClick={() => setLiveBanner(null)} 
              className="text-xs font-semibold bg-red-800 hover:bg-red-900 px-3 py-1.5 rounded transition-colors cursor-pointer"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* Real-time ANPR Plate Reading Toast */}
      {liveANPRBanner && (
        <div className="bg-slate-900 text-white p-3.5 rounded-xl shadow-lg flex items-center justify-between border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Car size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                  Vehicle Detected • Track #{liveANPRBanner.track_id} ({liveANPRBanner.vehicle_class.toUpperCase()})
                </span>
                <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                  liveANPRBanner.status === 'STABLE_VERIFIED' 
                    ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50' 
                    : 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                }`}>
                  {liveANPRBanner.status}
                </span>
              </div>
              <p className="text-sm font-mono font-black text-white mt-0.5">
                PLATE: {liveANPRBanner.plate_text || 'UNREADABLE'} 
                <span className="text-xs font-normal text-slate-400 ml-2">
                  (Confidence: {(liveANPRBanner.plate_confidence * 100).toFixed(0)}%, {liveANPRBanner.consistent_readings} frame consensus)
                </span>
              </p>
            </div>
          </div>
          <button 
            onClick={() => setLiveANPRBanner(null)} 
            className="text-xs font-medium text-slate-400 hover:text-white px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Level Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pipeline Status</p>
            {metrics?.camera_health === 'ERROR' || metrics?.camera_health === 'DISCONNECTED' ? (
              <p className="text-lg font-bold text-red-600 flex items-center gap-1.5 mt-0.5">
                <AlertTriangle size={18} /> Degraded / Offline
              </p>
            ) : metrics?.camera_health === 'CONNECTING' ? (
              <p className="text-lg font-bold text-amber-600 flex items-center gap-1.5 mt-0.5">
                <Activity size={18} className="animate-spin" /> Reconnecting
              </p>
            ) : (
              <p className="text-lg font-bold text-green-600 flex items-center gap-1.5 mt-0.5">
                <CheckCircle size={18} /> Operational
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <Radio size={11} className={isConnected ? "text-green-500 animate-pulse" : "text-slate-400"} />
              WebSocket: {isConnected ? "Live Connected" : "Connecting..."}
            </p>
          </div>
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${metrics?.camera_health === 'ERROR' || metrics?.camera_health === 'DISCONNECTED' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            <Shield size={20} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">AI Inference</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              {metrics?.fps !== undefined ? `${metrics.fps} FPS` : isConnected ? 'Measuring...' : 'Standby'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Latency: {metrics?.latency_ms !== undefined ? `${metrics.latency_ms} ms` : '0 ms'} | Drops: {metrics?.dropped_frames ?? 0}
            </p>
          </div>
          <div className="h-10 w-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
            <Activity size={20} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Live Active Tracks</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              {metrics ? `${metrics.active_tracks_count} Objects` : '0 Objects'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <Cpu size={11} /> CPU: {metrics?.cpu_percent ?? 0}% | RAM: {metrics?.ram_percent ?? 0}%
            </p>
          </div>
          <div className="h-10 w-10 bg-purple-50 rounded-full flex items-center justify-center text-purple-600">
            <Layers size={20} />
          </div>
        </div>

        <div className={`bg-white rounded-xl shadow-sm p-4 border flex items-center justify-between ${activeIncidents > 0 ? 'border-red-300 bg-red-50/50' : 'border-slate-200'}`}>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Alerts</p>
            <p className={`text-lg font-extrabold mt-0.5 ${activeIncidents > 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {activeIncidents} Unacknowledged
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Total Logged: {incidents?.length || 0}
            </p>
          </div>
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${activeIncidents > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
            <ShieldAlert size={20} />
          </div>
        </div>
      </div>

      {/* Main Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Live Camera Video Stream */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap justify-between items-center bg-white p-3 rounded-lg border border-slate-200 gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => handleSelectCamera('PHONE-CAM-01')}
                  className={`text-xs px-3 py-1.5 rounded-md font-bold transition-colors ${
                    selectedCameraId === 'PHONE-CAM-01'
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-emerald-700 hover:text-emerald-900'
                  }`}
                >
                  📱 PHONE-CAM-01 (Mobile WiFi)
                </button>
                <button
                  onClick={() => handleSelectCamera('WEBCAM-01')}
                  className={`text-xs px-3 py-1.5 rounded-md font-bold transition-colors ${
                    selectedCameraId === 'WEBCAM-01'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  💻 WEBCAM-01 (Laptop Webcam)
                </button>
              </div>
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono hidden sm:inline">
                {selectedCameraId === 'WEBCAM-01'
                  ? 'Local Laptop Webcam (/dev/video0)'
                  : 'Mobile WiFi IP Camera (Android/iOS)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/v1/dataset/capture', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ camera_id: selectedCameraId, notes: "Operator captured from Dashboard" }),
                    });
                    const d = await res.json();
                    if (res.ok) {
                      alert(`✅ Captured & Labeled: ${d.total_objects} objects found (${d.classes_detected.join(', ') || 'general frame'}). Saved for model training!`);
                    } else {
                      alert(`⚠️ Capture Notice: ${d.detail || 'Could not capture frame'}`);
                    }
                  } catch (e: any) {
                    alert(`⚠️ Capture Error: ${e.message}`);
                  }
                }}
                className="text-xs px-2.5 py-1 rounded font-bold flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm"
                title="Capture current video frame and auto-label for AI model training"
              >
                📸 Capture Training Sample
              </button>
              <button
                onClick={() => setCopilotOpen(true)}
                className="text-xs px-2.5 py-1 rounded font-bold flex items-center gap-1.5 bg-purple-700 hover:bg-purple-800 text-white transition-colors shadow-sm"
                title="Launch Tactical AI Copilot & Situation Report generator"
              >
                <Bot size={13} className="text-purple-200" />
                🤖 Tactical Copilot
              </button>
              {telemetry?.tracks && telemetry.tracks.length > 0 && (
                <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md font-mono font-bold border border-emerald-200 flex items-center gap-1">
                  <Activity size={12} className="text-emerald-500 animate-pulse" />
                  {telemetry.tracks.length} Targets (
                    {telemetry.tracks.filter(t => t.class_name === 'person').length}P, 
                    {telemetry.tracks.filter(t => t.class_name === 'vehicle').length}V, 
                    {telemetry.tracks.filter(t => t.class_name !== 'person' && t.class_name !== 'vehicle').length} Other
                  )
                </span>
              )}
              <button
                onClick={() => setShowOverlay(!showOverlay)}
                className={`text-xs px-2.5 py-1 rounded font-bold flex items-center gap-1.5 transition-colors shadow-sm ${
                  showOverlay ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title="Toggle real-time AI bounding boxes and zone overlay"
              >
                <Eye size={13} />
                {showOverlay ? 'AI Boxes: ON' : 'AI Boxes: OFF'}
              </button>
            </div>
          </div>

          {/* Quick Phone Camera Connect Bar */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="text-emerald-600 w-4 h-4" />
                <span className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                  Phone Camera Quick Connect
                </span>
                <span className="text-[11px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-mono">
                  IP Webcam / DroidCam
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-500 font-medium">Presets:</span>
                <button
                  type="button"
                  onClick={() => applyPreset('ipwebcam')}
                  className="px-2 py-0.5 rounded bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-semibold transition"
                >
                  📱 IP Webcam (:8080)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('droidcam')}
                  className="px-2 py-0.5 rounded bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-semibold transition"
                >
                  📹 DroidCam (:4747)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={phoneUrl}
                  onChange={(e) => setPhoneUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConnectPhone();
                  }}
                  placeholder="Enter phone IP (e.g. 192.168.1.5:8080 or http://192.168.1.5:8080/video)"
                  className="w-full text-xs font-mono px-3 py-2 bg-white border border-emerald-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={() => handleConnectPhone()}
                disabled={phoneConnecting}
                className="text-xs px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-md shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap"
              >
                {phoneConnecting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wifi size={13} />
                    Connect Phone Camera
                  </>
                )}
              </button>
            </div>

            {phoneStatus && (
              <div
                className={`text-[11px] px-2.5 py-1 rounded font-medium flex items-center justify-between ${
                  phoneStatus.success ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-red-100 text-red-800 border border-red-300'
                }`}
              >
                <span>{phoneStatus.msg}</span>
                <button
                  type="button"
                  onClick={() => setPhoneStatus(null)}
                  className="text-slate-400 hover:text-slate-700 ml-2 font-bold"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Primary Viewport with Synchronized Canvas/SVG Overlay */}
          <div className="relative bg-black rounded-xl overflow-hidden aspect-video shadow-lg border border-slate-800">
            {/* Live Camera Video Feed (Direct MJPEG Stream for all cameras with automatic reconnection) */}
            <div className="relative w-full h-full">
              <img
                key={`${selectedCameraId}-live-stream`}
                src={`/api/v1/cameras/${selectedCameraId}/stream`}
                alt={`${selectedCameraId} Live AI Feed`}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  setTimeout(() => {
                    img.src = `/api/v1/cameras/${selectedCameraId}/stream?t=${Date.now()}`;
                  }, 1200);
                }}
              />
            </div>


            {/* Real-time AI Bounding Boxes & Zones Overlay (Toggleable via AI Boxes button) */}
            {showOverlay && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                {/* 1. Authoritative Restricted Zone Polygons */}
                {zones.filter(z => !z.camera_id || z.camera_id === selectedCameraId).map((zone) => {
                  const ptsStr = zone.points.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ');
                  const firstPt = zone.points[0] || { x: 0.15, y: 0.15 };
                  return (
                    <g key={zone.zone_id}>
                      <polygon 
                        points={ptsStr}
                        fill="rgba(239, 68, 68, 0.12)"
                        stroke="#EF4444"
                        strokeWidth="2"
                        strokeDasharray="6,4"
                      />
                      <text 
                        x={firstPt.x * 1000 + 8} 
                        y={firstPt.y * 1000 + 20} 
                        fill="#EF4444" 
                        fontSize="15" 
                        fontWeight="bold"
                        className="drop-shadow"
                      >
                        ⚠️ {zone.name}
                      </text>
                    </g>
                  );
                })}

                {/* 2. Active Detected Tracks from YOLO & Tracker */}
                {(telemetry?.camera_id === selectedCameraId ? telemetry.tracks : [])?.map((track) => {
                  const bx = track.bbox.x1 * 1000;
                  const by = track.bbox.y1 * 1000;
                  const bw = Math.max(20, (track.bbox.x2 - track.bbox.x1) * 1000);
                  const bh = Math.max(20, (track.bbox.y2 - track.bbox.y1) * 1000);
                  const sub = (track.subclass || track.class_name).toLowerCase();
                  let strokeColor = '#3B82F6'; // Dodger Blue for person
                  if (sub === 'truck') strokeColor = '#EA580C';
                  else if (sub === 'motorcycle' || sub === 'bicycle') strokeColor = '#EAB308';
                  else if (sub === 'bus') strokeColor = '#2563EB';
                  else if (sub === 'car') strokeColor = '#10B981';
                  else if (track.class_name.toLowerCase() !== 'person') strokeColor = '#8B5CF6';

                  const displayLabel = `${sub.toUpperCase()} #${track.track_id} (${Math.round(track.confidence * 100)}%)`;

                  return (
                    <g key={track.track_id}>
                      {/* Bounding Box */}
                      <rect 
                        x={bx} 
                        y={by} 
                        width={bw} 
                        height={bh} 
                        fill="none" 
                        stroke={strokeColor} 
                        strokeWidth="2.5" 
                        rx="4"
                      />

                      {/* Primary Label Badge */}
                      <rect 
                        x={bx} 
                        y={Math.max(6, by - 22)} 
                        width={Math.max(130, bw * 0.92)} 
                        height="20" 
                        fill={strokeColor} 
                        rx="3"
                      />
                      <text 
                        x={bx + 5} 
                        y={Math.max(20, by - 7)} 
                        fill="#FFFFFF" 
                        fontSize="11" 
                        fontWeight="bold"
                      >
                        {displayLabel}
                      </text>

                      {/* ANPR License Plate Badge */}
                      {track.class_name === 'vehicle' && track.plate_text && (
                        <g>
                          <rect 
                            x={bx} 
                            y={Math.min(972, by + bh + 4)} 
                            width={Math.max(130, bw * 0.92)} 
                            height="20" 
                            fill="#0F172A" 
                            stroke="#38BDF8"
                            strokeWidth="1.5"
                            rx="3"
                          />
                          <text 
                            x={bx + 6} 
                            y={Math.min(987, by + bh + 18)} 
                            fill="#38BDF8" 
                            fontSize="11" 
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            PLATE: {track.plate_text}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}

            {/* Bottom Status Bar on Viewport */}
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex justify-between items-end text-xs text-white pointer-events-none">
              <div className="space-y-0.5">
                <p className="font-mono text-[11px] text-slate-300">
                  Camera: {selectedCameraId === 'WEBCAM-01' ? 'WEBCAM-01 (Laptop Webcam)' : selectedCameraId === 'PHONE-CAM-01' ? 'PHONE-CAM-01 (Mobile WiFi Stream)' : selectedCameraId} | YOLOv8n + IoU
                </p>
                <p className="font-semibold flex items-center gap-1.5 text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Active Tracks: {telemetry?.tracks?.length || 0}
                </p>
              </div>
              <div className="text-right">
                <span className="bg-black/60 px-2 py-1 rounded font-mono text-[11px] border border-white/10">
                  {metrics?.fps !== undefined ? `${metrics.fps} FPS` : isConnected ? 'Measuring...' : 'Standby'}
                </span>
              </div>
            </div>
          </div>

          {/* Multi-Camera Grid Architecture */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Active Camera Selection</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* PHONE-CAM-01 Card */}
              <button
                onClick={() => handleSelectCamera('PHONE-CAM-01')}
                className={`text-left border-2 rounded p-2 transition-all ${
                  selectedCameraId === 'PHONE-CAM-01' 
                    ? 'border-emerald-500 bg-slate-900 text-white shadow-sm ring-2 ring-emerald-400' 
                    : 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-slate-700'
                }`}
              >
                <p className="font-bold flex items-center justify-between text-emerald-900 dark:text-emerald-300">
                  PHONE-CAM-01 
                  <span className={`w-2 h-2 rounded-full ${selectedCameraId === 'PHONE-CAM-01' ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                </p>
                <p className={`text-[10px] mt-1 font-mono ${selectedCameraId === 'PHONE-CAM-01' ? 'text-emerald-300' : 'text-emerald-600'}`}>
                  MOBILE WIFI CAM
                </p>
              </button>

              {/* WEBCAM-01 Card */}
              <button
                onClick={() => handleSelectCamera('WEBCAM-01')}
                className={`text-left border-2 rounded p-2 transition-all ${
                  selectedCameraId === 'WEBCAM-01' 
                    ? 'border-indigo-500 bg-slate-900 text-white shadow-sm ring-2 ring-indigo-400' 
                    : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 text-slate-700'
                }`}
              >
                <p className="font-bold flex items-center justify-between text-indigo-900 dark:text-indigo-300">
                  WEBCAM-01 
                  <span className={`w-2 h-2 rounded-full ${selectedCameraId === 'WEBCAM-01' ? 'bg-indigo-400 animate-pulse' : 'bg-indigo-500'}`}></span>
                </p>
                <p className={`text-[10px] mt-1 font-mono ${selectedCameraId === 'WEBCAM-01' ? 'text-indigo-300' : 'text-indigo-600'}`}>
                  LAPTOP WEBCAM
                </p>
              </button>

              {/* CAM-02 Card */}
              <button
                onClick={() => handleSelectCamera('CAM-02')}
                className={`text-left border-2 rounded p-2 transition-all ${
                  selectedCameraId === 'CAM-02' 
                    ? 'border-blue-500 bg-slate-900 text-white shadow-sm ring-2 ring-blue-400' 
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <p className="font-bold flex items-center justify-between">
                  CAM-02 
                  <span className={`w-2 h-2 rounded-full ${selectedCameraId === 'CAM-02' ? 'bg-blue-400 animate-pulse' : 'bg-slate-300'}`}></span>
                </p>
                <p className={`text-[10px] mt-1 font-mono ${selectedCameraId === 'CAM-02' ? 'text-blue-300' : 'text-slate-500'}`}>
                  PERIMETER EAST
                </p>
              </button>
            </div>
          </div>

        </div>

        {/* Right Column: Live Incident Feed & Long-Term Remembrance */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[680px]">
          <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl gap-2">
            <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-lg">
              <button
                onClick={() => setActiveSideTab('detections')}
                className={`text-xs px-2 py-1 rounded font-bold transition-all ${
                  activeSideTab === 'detections'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🎯 Detections ({telemetry?.tracks?.length || 0})
              </button>
              <button
                onClick={() => setActiveSideTab('incidents')}
                className={`text-xs px-2 py-1 rounded font-bold transition-all ${
                  activeSideTab === 'incidents'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🚨 Alerts ({incidents?.length || 0})
              </button>
              <button
                onClick={() => setActiveSideTab('remembrance')}
                className={`text-xs px-2 py-1 rounded font-bold transition-all ${
                  activeSideTab === 'remembrance'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🧠 Memory ({remembranceProfiles.length})
              </button>
            </div>
            <span className="px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded-full font-mono font-bold">
              {activeSideTab === 'detections' ? 'Live AI Panel' : activeSideTab === 'incidents' ? 'Breach Feeds' : 'Cross-Camera'}
            </span>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-3">
            {activeSideTab === 'detections' ? (
              !telemetry?.tracks || telemetry.tracks.length === 0 ? (
                <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    <Target size={20} />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">No objects currently in view</p>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    Point your camera at a person, vehicle, phone, or object. Real-time AI detections will populate here instantly.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pb-1 border-b border-slate-100 font-medium">
                    <span>{telemetry.tracks.length} active target{telemetry.tracks.length > 1 ? 's' : ''} tracked</span>
                    <span className="font-mono text-emerald-600 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Real-Time AI
                    </span>
                  </div>
                  {telemetry.tracks.map((track) => {
                    const sub = (track.subclass || track.class_name).toLowerCase();
                    const isPerson = track.class_name.toLowerCase() === 'person';
                    const isVehicle = track.class_name.toLowerCase() === 'vehicle';
                    const badgeColor = isPerson 
                      ? 'bg-blue-100 text-blue-800 border-blue-200'
                      : isVehicle
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-purple-100 text-purple-800 border-purple-200';

                    return (
                      <div
                        key={track.track_id}
                        className="p-3 bg-white border border-slate-200 rounded-lg shadow-xs hover:border-slate-300 transition-all text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${badgeColor}`}>
                            {isPerson ? '👤' : isVehicle ? '🚗' : '📦'} {sub.toUpperCase()} #{track.track_id}
                          </span>
                          <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {Math.round(track.confidence * 100)}% Conf
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1">
                          <div>
                            <span className="text-slate-400">Class:</span>{' '}
                            <span className="font-semibold text-slate-800 capitalize">{sub}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Position:</span>{' '}
                            <span className="font-mono">
                              {Math.round(track.bbox.x1 * 100)}%, {Math.round(track.bbox.y1 * 100)}%
                            </span>
                          </div>
                        </div>

                        {track.reid_id && (
                          <div className="text-[10px] text-indigo-700 bg-indigo-50/70 px-2 py-0.5 rounded font-mono truncate">
                            Global Re-ID: {track.reid_id}
                          </div>
                        )}

                        {track.plate_text && (
                          <div className="text-[11px] bg-slate-900 text-yellow-400 px-2 py-1 rounded font-mono font-bold flex items-center justify-between">
                            <span>PLATE: {track.plate_text}</span>
                            <span className="text-[9px] text-slate-400">{track.plate_status}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : activeSideTab === 'incidents' ? (
              incLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs">Loading incident records...</div>
              ) : incidents?.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <CheckCircle size={28} className="text-green-500" />
                  <p className="text-xs font-medium">Zero active perimeter intrusions.</p>
                </div>
              ) : (
                incidents?.map((incident) => (
                  <div 
                    key={incident.id} 
                    className={`p-3 rounded-lg border text-xs transition-all ${
                      incident.acknowledged 
                        ? 'bg-slate-50/70 border-slate-200 opacity-70' 
                        : 'bg-white border-red-200 shadow-sm'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <SeverityBadge severity={incident.severity} />
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock size={10} />
                        {formatDistanceToNow(new Date(incident.timestamp.endsWith('Z') ? incident.timestamp : incident.timestamp + 'Z'), { addSuffix: true })}
                      </span>
                    </div>

                    <div className="my-1.5 flex items-center justify-between gap-1 flex-wrap">
                      <EventTypeBadge eventType={incident.event_type} />
                      <span className="font-mono text-[10px] text-slate-400 font-bold">
                        {incident.camera_id}
                      </span>
                    </div>
                    <p className="text-slate-600 text-[11px] mt-0.5 leading-snug">
                      {incident.explanation || `${incident.event_type} on ${incident.camera_id}`}
                    </p>

                    {incident.evidence_reference && (
                      <div className="mt-2.5 rounded overflow-hidden border border-slate-200 bg-slate-50">
                        <img 
                          src={`/evidence/${incident.evidence_reference.split(/[/\\]/).pop()}`} 
                          alt="Breach Evidence"
                          className="w-full h-24 object-cover"
                          loading="lazy"
                        />
                        {incident.sha256 && (
                          <div className="px-2 py-1 text-[9px] text-slate-500 font-mono truncate border-t border-slate-200 bg-white" title={incident.sha256}>
                            SHA-256: {incident.sha256}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setFeedbackIncident(incident);
                          setIsFeedbackOpen(true);
                        }}
                        className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer border border-slate-300"
                        title="Submit Operator Ground Truth Feedback (True Intrusion / False Alarm / Unsure)"
                      >
                        <MessageSquare size={12} /> Feedback
                      </button>
                      {!incident.acknowledged && (
                        <button 
                          onClick={() => acknowledge(incident.id)}
                          className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] transition-colors cursor-pointer"
                        >
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )
            ) : (
              remembranceProfiles.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <CheckCircle size={28} className="text-indigo-400" />
                  <p className="text-xs font-medium">No tracked entities in memory store yet.</p>
                </div>
              ) : (
                remembranceProfiles.map((prof) => {
                  const sub = (prof.subclass || prof.entity_type).toLowerCase();
                  const badgeBg = sub === 'truck' ? 'bg-orange-100 text-orange-800 border-orange-200'
                    : sub === 'car' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    : sub === 'motorcycle' || sub === 'bicycle' ? 'bg-amber-100 text-amber-800 border-amber-200'
                    : sub === 'bus' ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-indigo-100 text-indigo-800 border-indigo-200';

                  return (
                    <div key={prof.global_id} className="p-3 rounded-lg border border-slate-200 bg-white shadow-xs text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded border uppercase ${badgeBg}`}>
                            {sub}
                          </span>
                          <span className="font-mono font-bold text-slate-900">{prof.global_id}</span>
                        </div>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                          {prof.total_sightings} sight{prof.total_sightings === 1 ? '' : 's'}
                        </span>
                      </div>

                      {prof.license_plate && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500">PLATE:</span>
                          <span className="px-2 py-0.5 bg-slate-900 text-yellow-300 font-mono font-bold rounded border border-slate-800 tracking-wider">
                            {prof.license_plate}
                          </span>
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-100">
                        <span>Seen on: {prof.cameras_seen?.join(', ') || 'CAM-01'}</span>
                        <span>Conf: {(prof.confidence_avg * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>
      </div>

      {/* Vehicle Analytics & ANPR Detections Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <Car size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Vehicle Analytics & ANPR Observations</h2>
              <p className="text-[11px] text-slate-500">Multi-frame consensus license plate recognition records</p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-xs bg-slate-200 text-slate-700 rounded-full font-mono font-bold">
            {anprRecords?.length || 0} Observations
          </span>
        </div>

        <div className="p-4">
          {anprLoading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Loading vehicle observations...</div>
          ) : anprRecords?.length === 0 ? (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
              <Car size={28} className="text-slate-300" />
              <p className="text-xs font-medium">No vehicle license plates logged yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px] bg-slate-50">
                    <th className="p-2.5">Time</th>
                    <th className="p-2.5">Camera / Track</th>
                    <th className="p-2.5">Vehicle Type</th>
                    <th className="p-2.5">License Plate</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Consensus</th>
                    <th className="p-2.5">Confidence</th>
                    <th className="p-2.5">Evidence (SHA-256)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {anprRecords?.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-2.5 text-slate-500 font-mono text-[11px]">
                        {formatDistanceToNow(new Date(rec.timestamp), { addSuffix: true })}
                      </td>
                      <td className="p-2.5 font-bold text-slate-800">
                        {rec.camera_id} <span className="font-mono font-normal text-slate-400">#TRK-{rec.track_id}</span>
                      </td>
                      <td className="p-2.5">
                        <span className="px-2 py-0.5 rounded font-bold uppercase text-[10px] bg-blue-50 text-blue-700 border border-blue-200">
                          {rec.vehicle_class}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono font-black text-slate-900 text-xs">
                        {rec.plate_text || <span className="text-slate-400 font-normal italic">UNREADABLE</span>}
                      </td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          rec.status === 'STABLE_VERIFIED' 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                            : rec.status === 'CANDIDATE'
                            ? 'bg-blue-100 text-blue-800 border border-blue-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono text-[11px] text-slate-600">
                        {rec.consistent_readings} frames
                      </td>
                      <td className="p-2.5 font-mono text-[11px] font-bold text-slate-700">
                        {(rec.plate_confidence * 100).toFixed(1)}%
                      </td>
                      <td className="p-2.5">
                        {rec.evidence_path ? (
                          <div className="flex items-center gap-2">
                            <img 
                              src={`/evidence/${rec.evidence_path.split(/[/\\]/).pop()}`} 
                              alt="Plate Crop"
                              className="h-7 w-12 object-cover rounded border border-slate-200 bg-slate-100"
                              loading="lazy"
                            />
                            {rec.evidence_sha256 && (
                              <span className="font-mono text-[9px] text-slate-400 truncate max-w-[120px]" title={rec.evidence_sha256}>
                                {rec.evidence_sha256.slice(0, 10)}...
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[10px]">No crop</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Perimeter Incidents & Operator Feedback Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-red-100 text-red-700 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Perimeter Incidents & Operator Feedback Table</h2>
              <p className="text-[11px] text-slate-500">Live operational breach ledger with active learning human-in-the-loop validation</p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-xs bg-slate-200 text-slate-700 rounded-full font-mono font-bold">
            {incidents?.length || 0} Incidents Logged
          </span>
        </div>

        <div className="p-4">
          {incLoading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Loading incident records...</div>
          ) : incidents?.length === 0 ? (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle size={28} className="text-emerald-500" />
              <p className="text-xs font-medium">No border incidents or temporal breaches logged.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px] bg-slate-50">
                    <th className="p-2.5">Time</th>
                    <th className="p-2.5">Camera</th>
                    <th className="p-2.5">Event Type</th>
                    <th className="p-2.5">Severity</th>
                    <th className="p-2.5">Confidence</th>
                    <th className="p-2.5">Explanation</th>
                    <th className="p-2.5">Evidence (SHA-256)</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Operator Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incidents?.map((inc) => {
                    const evFile = inc.evidence_reference?.split(/[/\\]/).pop();
                    return (
                      <tr key={inc.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {formatDistanceToNow(new Date(inc.timestamp.endsWith('Z') ? inc.timestamp : inc.timestamp + 'Z'), { addSuffix: true })}
                        </td>
                        <td className="p-2.5 font-bold text-slate-800">
                          {inc.camera_id}
                        </td>
                        <td className="p-2.5">
                          <EventTypeBadge eventType={inc.event_type} />
                        </td>
                        <td className="p-2.5">
                          <SeverityBadge severity={inc.severity} />
                        </td>
                        <td className="p-2.5 font-mono font-bold text-slate-700">
                          {(inc.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="p-2.5 text-slate-600 max-w-xs truncate" title={inc.explanation}>
                          {inc.explanation || `${inc.event_type} on ${inc.camera_id}`}
                        </td>
                        <td className="p-2.5">
                          {evFile ? (
                            <div className="flex items-center gap-2">
                              <img
                                src={`/evidence/${evFile}`}
                                alt="Evidence"
                                className="h-7 w-12 object-cover rounded border border-slate-200 bg-slate-100"
                                loading="lazy"
                              />
                              {inc.sha256 && (
                                <span className="font-mono text-[9px] text-slate-400 truncate max-w-[100px]" title={inc.sha256}>
                                  {inc.sha256.slice(0, 10)}...
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[10px]">No image</span>
                          )}
                        </td>
                        <td className="p-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            inc.acknowledged ? 'bg-slate-100 text-slate-600' : 'bg-red-100 text-red-800 border border-red-200'
                          }`}>
                            {inc.status || (inc.acknowledged ? 'ACKNOWLEDGED' : 'NEW')}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <div className="flex justify-end items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => {
                                setFeedbackIncident(inc);
                                setIsFeedbackOpen(true);
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                              title="Provide operator feedback (True Intrusion / False Alarm / Unsure)"
                            >
                              <MessageSquare size={11} /> Feedback
                            </button>
                            {!inc.acknowledged && (
                              <button
                                onClick={() => acknowledge(inc.id)}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                Acknowledge
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Tactical AI Copilot Modal Dialog */}
      {copilotOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-600 rounded-lg text-white">
                  <Bot size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    IBVAP Tactical AI Copilot
                    <span className="px-1.5 py-0.5 text-[10px] bg-purple-800 text-purple-200 rounded font-mono font-normal">
                      NVIDIA NIM / Border Defense
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Natural language intelligence synthesis across cameras & remembrance store
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCopilotOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Action Pills */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2 text-xs">
              <button
                onClick={handleGenerateSITREP}
                disabled={copilotLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold bg-purple-100 text-purple-900 hover:bg-purple-200 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                <Sparkles size={13} className="text-purple-600" />
                ⚡ Generate Shift SITREP
              </button>
              <button
                onClick={() => handleSendCopilotQuery('Are there any trucks detected?')}
                disabled={copilotLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                🚚 Trucks Sighted
              </button>
              <button
                onClick={() => handleSendCopilotQuery('Show verified license plates')}
                disabled={copilotLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                📋 License Plates
              </button>
              <button
                onClick={() => handleSendCopilotQuery('Any personnel or intruders loitering near fence?')}
                disabled={copilotLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-slate-200 text-slate-800 hover:bg-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                🚶 Personnel Status
              </button>
            </div>

            {/* Chat History / Intelligence Terminal */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 min-h-[260px] text-xs font-sans">
              {copilotHistory.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl p-3 shadow-2xs ${
                      item.role === 'user'
                        ? 'bg-purple-600 text-white font-medium'
                        : 'bg-white text-slate-800 border border-slate-200'
                    }`}
                  >
                    {item.role === 'assistant' && (
                      <div className="flex items-center justify-between mb-1 pb-1 border-b border-slate-100 text-[10px] text-slate-400">
                        <span className="font-bold text-purple-700 flex items-center gap-1">
                          <Terminal size={11} /> {item.source || 'Tactical Intelligence Engine'}
                        </span>
                        {item.threat && (
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                            item.threat === 'ELEVATED'
                              ? 'bg-red-100 text-red-700'
                              : item.threat === 'GUARDED'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            THREAT: {item.threat}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="whitespace-pre-line leading-relaxed">{item.text}</p>
                  </div>
                </div>
              ))}
              {copilotLoading && (
                <div className="flex items-center gap-2 text-slate-500 text-xs italic p-2 bg-white rounded-lg border border-slate-200 w-fit">
                  <Loader2 size={14} className="animate-spin text-purple-600" />
                  Synthesizing multi-camera telemetry & tactical SITREP...
                </div>
              )}
            </div>

            {/* Natural Language Query Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCopilotQuery();
              }}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
            >
              <input
                type="text"
                value={copilotQuery}
                onChange={(e) => setCopilotQuery(e.target.value)}
                placeholder="Ask Tactical Copilot: e.g. Has any truck breached sector alpha?"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                type="submit"
                disabled={copilotLoading || !copilotQuery.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              >
                <Send size={13} />
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Operator Feedback Active Learning Modal */}
      <OperatorFeedbackModal
        incident={feedbackIncident}
        isOpen={isFeedbackOpen}
        onClose={() => {
          setIsFeedbackOpen(false);
          setFeedbackIncident(null);
        }}
      />
    </div>
  );
};
