import React, { useState } from 'react';
import { useIncidents, useAcknowledgeIncident, useUpdateIncidentStatus } from '../api/hooks';
import { format } from 'date-fns';
import { Search, Filter, AlertTriangle, CheckCircle, Clock, ShieldCheck, HelpCircle, MessageSquare } from 'lucide-react';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { OperatorFeedbackModal } from '../components/OperatorFeedbackModal';

const SeverityBadge = ({ severity }: { severity: string }) => {
  const colors = {
    INFO: 'bg-slate-100 text-slate-700',
    LOW: 'bg-yellow-100 text-yellow-800',
    MEDIUM: 'bg-orange-100 text-orange-800',
    HIGH: 'bg-red-100 text-red-800',
    CRITICAL: 'bg-red-600 text-white shadow-sm',
  };
  return (
    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[severity as keyof typeof colors] || colors.INFO}`}>
      {severity}
    </span>
  );
};

const StatusBadge = ({ status }: { status?: string }) => {
  const current = status || 'NEW';
  const badges: Record<string, { bg: string; text: string; label: string }> = {
    NEW: { bg: 'bg-orange-100 text-orange-800 border-orange-200', label: 'NEW', text: 'text-orange-600' },
    ACKNOWLEDGED: { bg: 'bg-blue-100 text-blue-800 border-blue-200', label: 'ACKNOWLEDGED', text: 'text-blue-600' },
    INVESTIGATING: { bg: 'bg-purple-100 text-purple-800 border-purple-200', label: 'INVESTIGATING', text: 'text-purple-600' },
    RESOLVED: { bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'RESOLVED', text: 'text-emerald-600' },
  };
  const cfg = badges[current] || badges.NEW;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
};

export const Incidents = () => {
  const [filterUnack, setFilterUnack] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [feedbackIncident, setFeedbackIncident] = useState<any>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const { data: incidents, isLoading } = useIncidents(100, filterUnack);
  const { mutate: updateStatus } = useUpdateIncidentStatus();

  const filtered = incidents?.filter(inc => {
    if (statusFilter === 'ALL') return true;
    const currentStatus = inc.status || (inc.acknowledged ? 'ACKNOWLEDGED' : 'NEW');
    return currentStatus === statusFilter;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Incident Management</h1>
          <p className="text-slate-500 text-sm mt-1">Review lifecycle states, cryptographic ledger provenance, and operator resolutions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-semibold text-slate-700">
            {['ALL', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-md transition-all ${statusFilter === st ? 'bg-white shadow text-slate-900' : 'hover:text-slate-900'}`}
              >
                {st}
              </button>
            ))}
          </div>
          <button 
            onClick={() => setFilterUnack(!filterUnack)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterUnack ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            <Filter size={16} />
            {filterUnack ? 'Showing Unresolved' : 'Filter: Unresolved'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4">Camera</th>
                <th className="px-6 py-4">Severity</th>
                <th className="px-6 py-4">Event Type</th>
                <th className="px-6 py-4">Confidence</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Lifecycle Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">Loading incidents database...</td>
                </tr>
              ) : filtered?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400 flex flex-col items-center justify-center">
                    <CheckCircle size={32} className="text-green-400 mb-2" />
                    <p>No incidents match the current filter.</p>
                  </td>
                </tr>
              ) : (
                filtered?.map((inc) => {
                  const currentStatus = inc.status || (inc.acknowledged ? 'ACKNOWLEDGED' : 'NEW');
                  return (
                    <tr key={inc.id} className={`hover:bg-slate-50 transition-colors ${currentStatus === 'NEW' ? 'bg-red-50/20' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {format(new Date(inc.timestamp.endsWith('Z') ? inc.timestamp : inc.timestamp + 'Z'), 'MMM dd, HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">{inc.camera_id}</td>
                      <td className="px-6 py-4"><SeverityBadge severity={inc.severity} /></td>
                      <td className="px-6 py-4">
                        <EventTypeBadge eventType={inc.event_type} />
                        <div className="text-xs text-slate-500 mt-1 truncate max-w-xs font-medium" title={inc.explanation}>
                          {inc.explanation}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500" 
                              style={{ width: `${Math.round(inc.confidence * 100)}%` }}
                            ></div>
                          </div>
                          <span className="text-xs font-mono">{Math.round(inc.confidence * 100)}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={currentStatus} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end items-center gap-1.5 flex-wrap">
                          {/* Operator Feedback Button */}
                          <button
                            onClick={() => {
                              setFeedbackIncident(inc);
                              setIsFeedbackOpen(true);
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                            title="Submit Operator Ground Truth Feedback (True Intrusion / False Alarm / Unsure)"
                          >
                            <MessageSquare size={12} /> Feedback
                          </button>

                          {currentStatus === 'NEW' && (
                            <button 
                              onClick={() => updateStatus({ incidentId: inc.id, status: 'ACKNOWLEDGED' })}
                              className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 transition-colors"
                            >
                              Acknowledge
                            </button>
                          )}
                          {currentStatus === 'ACKNOWLEDGED' && (
                            <button 
                              onClick={() => updateStatus({ incidentId: inc.id, status: 'INVESTIGATING' })}
                              className="px-2.5 py-1 bg-purple-600 text-white rounded text-xs font-semibold hover:bg-purple-700 transition-colors"
                            >
                              Investigate
                            </button>
                          )}
                          {(currentStatus === 'ACKNOWLEDGED' || currentStatus === 'INVESTIGATING') && (
                            <button 
                              onClick={() => updateStatus({ incidentId: inc.id, status: 'RESOLVED' })}
                              className="px-2.5 py-1 bg-emerald-700 text-white rounded text-xs font-semibold hover:bg-emerald-800 transition-colors"
                            >
                              Resolve
                            </button>
                          )}
                          {currentStatus === 'RESOLVED' && (
                            <span className="text-xs text-emerald-600 font-medium inline-flex items-center gap-1">
                              <CheckCircle size={14} /> Closed
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
