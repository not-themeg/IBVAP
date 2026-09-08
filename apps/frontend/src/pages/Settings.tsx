import React, { useState, useEffect } from 'react';
import { Sliders, Cpu, Shield, Save, CheckCircle, Smartphone, Moon, Camera, Database, Eye, Search, Wifi, Loader2 } from 'lucide-react';

interface DiscoveredCamera {
  ip: string;
  port: number;
  camera_type: string;
  stream_url: string;
  is_live: boolean;
  response_time_ms: number;
}

interface SystemSettingsState {
  phone_camera_url: string;
  confidence_threshold: number;
  iou_threshold: number;
  face_detection_enabled: boolean;
  anpr_enabled: boolean;
  night_enhancement_enabled: boolean;
  loitering_threshold_seconds: number;
  auto_dataset_capture: boolean;
}

const defaultSettings: SystemSettingsState = {
  phone_camera_url: "http://192.168.1.5:8080/video",
  confidence_threshold: 0.25,
  iou_threshold: 0.20,
  face_detection_enabled: true,
  anpr_enabled: true,
  night_enhancement_enabled: true,
  loitering_threshold_seconds: 15,
  auto_dataset_capture: false,
};

export const Settings = () => {
  const [settings, setSettings] = useState<SystemSettingsState>(defaultSettings);
  const [datasetStats, setDatasetStats] = useState<{ total_samples: number; vehicle_crops: number; face_crops: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load persisted settings from backend
    fetch('/api/v1/settings/')
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch settings");
        return res.json();
      })
      .then((data) => {
        setSettings({
          phone_camera_url: data.phone_camera_url ?? defaultSettings.phone_camera_url,
          confidence_threshold: data.confidence_threshold ?? defaultSettings.confidence_threshold,
          iou_threshold: data.iou_threshold ?? defaultSettings.iou_threshold,
          face_detection_enabled: data.face_detection_enabled ?? defaultSettings.face_detection_enabled,
          anpr_enabled: data.anpr_enabled ?? defaultSettings.anpr_enabled,
          night_enhancement_enabled: data.night_enhancement_enabled ?? defaultSettings.night_enhancement_enabled,
          loitering_threshold_seconds: data.loitering_threshold_seconds ?? defaultSettings.loitering_threshold_seconds,
          auto_dataset_capture: data.auto_dataset_capture ?? defaultSettings.auto_dataset_capture,
        });
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Could not load backend settings, using local defaults:", err);
        setLoading(false);
      });

    // Load dataset stats
    fetch('/api/v1/dataset/stats')
      .then((res) => res.json())
      .then((stats) => setDatasetStats(stats))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setError(null);
    try {
      const res = await fetch('/api/v1/settings/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Backend failed to save settings");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message || "Failed to persist settings");
    }
  };

  const [discovering, setDiscovering] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<DiscoveredCamera[]>([]);
  const [discoveryMsg, setDiscoveryMsg] = useState<string | null>(null);

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoveryMsg("Scanning local WiFi network & ARP cache for active IP cameras...");
    try {
      const res = await fetch('/api/v1/settings/discover-cameras', { method: 'POST' });
      if (!res.ok) throw new Error("Auto-discovery request failed");
      const data: DiscoveredCamera[] = await res.json();
      setDiscoveredCameras(data);
      if (data.length === 0) {
        setDiscoveryMsg("No mobile IP cameras found on port 8080/4747. Ensure 'IP Webcam' or 'DroidCam' is running and 'Start Server' is clicked on your phone.");
      } else {
        setDiscoveryMsg(`Discovered ${data.length} active camera stream(s) on your WiFi network!`);
      }
    } catch (err: any) {
      setDiscoveryMsg("Discovery error: " + (err.message || String(err)));
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectDiscovered = (streamUrl: string) => {
    setSettings(prev => ({ ...prev, phone_camera_url: streamUrl }));
    setDiscoveryMsg(`Applied camera stream: ${streamUrl}. Click 'Save Changes' to activate!`);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System & AI Analytics Settings</h1>
          <p className="text-slate-500 text-sm mt-1">
            Configure mobile camera stream, detection sensitivity, AI modules, and model fine-tuning.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Save size={16} /> Save Changes
        </button>
      </div>

      {saved && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm">
          <CheckCircle size={16} className="text-emerald-600" />
          Settings successfully persisted to disk and applied across active video pipeline.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 text-red-800 border border-red-200 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100">
        {/* Mobile Camera WiFi Stream Configuration */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
            <Smartphone size={22} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mobile WiFi Camera Stream (PHONE-CAM-01)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Stream live video from your Android/iOS device using apps like "IP Webcam".
                </p>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                WiFi MJPEG / RTSP
              </span>
            </div>
            <div className="mt-3">
              <input
                type="text"
                value={settings.phone_camera_url}
                onChange={(e) => setSettings({ ...settings, phone_camera_url: e.target.value })}
                placeholder="http://192.168.1.X:8080/video or rtsp://192.168.1.X:8080/h264_pcm.sdp"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-400">
                  Tip: Ensure your laptop and phone are on the same WiFi router or hotspot.
                </p>
                <button
                  type="button"
                  onClick={handleDiscover}
                  disabled={discovering}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-bold transition-all shadow-sm"
                >
                  {discovering ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  {discovering ? "Scanning WiFi..." : "🔍 Auto-Discover Phone on WiFi"}
                </button>
              </div>

              {discoveryMsg && (
                <div className="mt-3 p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
                  <span>{discoveryMsg}</span>
                  {discovering && <span className="text-[10px] text-emerald-600 font-mono animate-pulse">Probing ARP table...</span>}
                </div>
              )}

              {discoveredCameras.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Wifi size={13} className="text-emerald-600" /> Discovered Cameras on Network:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {discoveredCameras.map((cam, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50 flex flex-col justify-between gap-1.5"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800">{cam.camera_type}</span>
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold">
                              {cam.response_time_ms}ms
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-600 truncate mt-0.5" title={cam.stream_url}>
                            {cam.stream_url}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectDiscovered(cam.stream_url)}
                          className="w-full py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors text-center shadow-xs"
                        >
                          Use This Stream
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Detection Sensitivity */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
            <Cpu size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">AI Detection Sensitivity (YOLOv8)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Minimum confidence score required to register human and vehicle bounding boxes.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={settings.confidence_threshold}
                onChange={(e) => setSettings({ ...settings, confidence_threshold: parseFloat(e.target.value) })}
                className="w-64 accent-blue-600"
              />
              <span className="font-mono text-sm font-bold text-slate-800">
                {Math.round(settings.confidence_threshold * 100)}% Confidence
              </span>
            </div>
          </div>
        </div>

        {/* Multi-Object Tracking IoU Matching */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg">
            <Sliders size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Multi-Object Tracking (IoU Overlap)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Overlap ratio required to retain persistent track IDs between consecutive frames.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={settings.iou_threshold}
                onChange={(e) => setSettings({ ...settings, iou_threshold: parseFloat(e.target.value) })}
                className="w-64 accent-purple-600"
              />
              <span className="font-mono text-sm font-bold text-slate-800">
                {settings.iou_threshold.toFixed(2)} IoU
              </span>
            </div>
          </div>
        </div>

        {/* AI Analytics Feature Toggles (Aligned with SIH PS-26187) */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
            <Eye size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Active Border Surveillance AI Modules</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enable or disable software-defined surveillance intelligence modules.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.face_detection_enabled}
                  onChange={(e) => setSettings({ ...settings, face_detection_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <p className="text-xs font-bold text-slate-800">Software Face Detection (FRS)</p>
                  <p className="text-[11px] text-slate-500">Haar cascade face tracking on detected persons</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.anpr_enabled}
                  onChange={(e) => setSettings({ ...settings, anpr_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <p className="text-xs font-bold text-slate-800">ANPR License Plate Recognition</p>
                  <p className="text-[11px] text-slate-500">Multi-frame consensus OCR for border vehicle gates</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.night_enhancement_enabled}
                  onChange={(e) => setSettings({ ...settings, night_enhancement_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <p className="text-xs font-bold text-slate-800">Night-Time / Low-Light CLAHE</p>
                  <p className="text-[11px] text-slate-500">Dynamic adaptive histogram contrast equalization</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.auto_dataset_capture}
                  onChange={(e) => setSettings({ ...settings, auto_dataset_capture: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <p className="text-xs font-bold text-slate-800">Auto Dataset Collection</p>
                  <p className="text-[11px] text-slate-500">Auto-save vehicle crops & faces for model training</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Dataset Collection & Model Training Status */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Database size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Border AI Model Training & Dataset Hub</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live captured samples, vehicle license plates, and face images ready for model fine-tuning.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                <p className="text-xs text-slate-500 font-medium">Full Frames</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">{datasetStats?.total_samples ?? 0}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                <p className="text-xs text-slate-500 font-medium">Vehicle Crops</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">{datasetStats?.vehicle_crops ?? 0}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                <p className="text-xs text-slate-500 font-medium">Face Crops</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">{datasetStats?.face_crops ?? 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Hardware Acceleration Info */}
        <div className="p-5 flex items-start gap-4">
          <div className="p-2.5 bg-slate-50 text-slate-600 rounded-lg">
            <Shield size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">Inference Hardware Acceleration</h3>
            <p className="text-xs text-slate-500 mt-0.5">Hardware backend utilized for neural network forward pass.</p>
            <div className="mt-3">
              <span className="px-3 py-1 bg-slate-100 text-slate-800 rounded font-mono text-xs font-semibold">
                Intel CPU (OpenCV DNN / PyTorch Native)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
