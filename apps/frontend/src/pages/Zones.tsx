import React, { useState, useEffect } from 'react';
import { CheckCircle, Layers } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Zone {
  zone_id: string;
  name: string;
  camera_id: string;
  zone_type: string;
  enabled: boolean;
  color: string;
  points: Point[];
}

export const Zones = () => {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);

  useEffect(() => {
    fetch('/api/v1/zones')
      .then(res => res.json())
      .then(data => {
        if (data.zones) {
          setZones(data.zones);
          if (data.zones.length > 0) setSelectedZone(data.zones[0]);
        }
      })
      .catch(err => console.error('Failed to load zones:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Spatial Virtual Fencing & Zones</h1>
          <p className="text-slate-500 text-sm mt-1">
            Define geometric polygons, intrusion boundary tripwires, and restricted sectors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <CheckCircle size={14} /> {zones.length} Active Spatial Rules
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <Layers size={16} className="text-blue-600" />
              Authoritative Geometry Canvas (Normalized 0.0 - 1.0)
            </h2>
            <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
              {selectedZone ? `${selectedZone.name} (${selectedZone.camera_id})` : 'All Zones'}
            </span>
          </div>

          <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-video border border-slate-800 flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                  <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="1000" height="1000" fill="url(#grid)" />

              {zones.map((zone) => {
                const ptsStr = zone.points.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ');
                const isSelected = selectedZone?.zone_id === zone.zone_id;
                const firstPt = zone.points[0] || { x: 0.5, y: 0.5 };

                return (
                  <g key={zone.zone_id}>
                    <polygon
                      points={ptsStr}
                      fill={isSelected ? 'rgba(239, 68, 68, 0.35)' : 'rgba(59, 130, 246, 0.20)'}
                      stroke={isSelected ? '#EF4444' : '#3B82F6'}
                      strokeWidth={isSelected ? '4' : '2'}
                      strokeDasharray="8,4"
                    />
                    {zone.points.map((pt, pIdx) => (
                      <circle
                        key={pIdx}
                        cx={pt.x * 1000}
                        cy={pt.y * 1000}
                        r={isSelected ? 6 : 4}
                        fill="#FFFFFF"
                        stroke={isSelected ? '#EF4444' : '#3B82F6'}
                        strokeWidth="2"
                      />
                    ))}
                    <text
                      x={firstPt.x * 1000 + 10}
                      y={firstPt.y * 1000 + 30}
                      fill={isSelected ? '#EF4444' : '#60A5FA'}
                      fontSize="22"
                      fontWeight="bold"
                    >
                      {zone.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <p className="text-xs text-slate-500">
            Bounding points are mathematically mapped in real-time using ray-casting algorithms to evaluate intrusions on every incoming camera frame.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4">
          <h2 className="font-bold text-sm text-slate-800">Configured Perimeter Zones</h2>
          
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-8 text-xs text-slate-400">Loading spatial configurations...</div>
            ) : zones.map((z) => (
              <div
                key={z.zone_id}
                onClick={() => setSelectedZone(z)}
                className={`p-3.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  selectedZone?.zone_id === z.zone_id
                    ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{z.name}</p>
                    <p className="text-slate-500 font-mono text-[11px] mt-0.5">ID: {z.zone_id}</p>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">
                    {z.zone_type}
                  </span>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-[11px] text-slate-600">
                  <span>Camera: <strong className="text-slate-800">{z.camera_id}</strong></span>
                  <span>Vertices: <strong className="text-slate-800">{z.points.length} points</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
