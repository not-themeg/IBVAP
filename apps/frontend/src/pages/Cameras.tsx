import React, { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useCameras } from '../api/hooks';
import apiClient from '../api/client';
import { format } from 'date-fns';
import { Video, Plus, Settings, Trash2, Edit2, Camera as CameraIcon } from 'lucide-react';

export const Cameras = () => {
  const queryClient = useQueryClient();
  const { data: cameras, isLoading } = useCameras();
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', rtsp_url: '', scenario: 'daytime' });

  // Add Camera API Call
  const addCameraMutation = useMutation({
    mutationFn: async (newCamera: any) => {
      const { data } = await apiClient.post('/cameras/', newCamera);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowAddModal(false);
      setFormData({ id: '', name: '', rtsp_url: '', scenario: 'daytime' });
    }
  });

  // Delete Camera API Call
  const deleteCameraMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addCameraMutation.mutate(formData);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Camera Management</h1>
          <p className="text-slate-500 text-sm mt-1">Configure RTSP streams and view system cameras.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          <Plus size={16} />
          Add Camera
        </button>
      </div>

      {/* Cameras Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Camera ID</th>
                <th className="px-6 py-4">Name & Location</th>
                <th className="px-6 py-4">Scenario (AI Profile)</th>
                <th className="px-6 py-4">Added On</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : cameras?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Video size={32} className="mx-auto text-slate-300 mb-2" />
                    <p>No cameras configured yet. Click "Add Camera" to begin.</p>
                  </td>
                </tr>
              ) : (
                cameras?.map((cam) => (
                  <tr key={cam.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {cam.enabled ? (
                        <span className="flex items-center gap-2 text-green-600 font-medium text-xs">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>ACTIVE
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-slate-500 font-medium text-xs">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span>DISABLED
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900">{cam.id}</td>
                    <td className="px-6 py-4 font-medium text-slate-700">{cam.name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded text-xs font-semibold uppercase">
                        {cam.scenario.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">{format(new Date(cam.created_at), 'MMM dd, yyyy')}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3 text-slate-400">
                        <button onClick={() => deleteCameraMutation.mutate(cam.id)} className="hover:text-red-600 transition-colors" title="Delete">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Camera Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Add New Camera</h2>
            <p className="text-sm text-slate-500 mb-6">Enter camera details. RTSP URL will be securely hashed in database.</p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Camera ID (e.g. CAM-05)</label>
                <input required type="text" value={formData.id} onChange={(e) => setFormData({...formData, id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Friendly Name</label>
                <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">RTSP Stream URL</label>
                <input required type="text" value={formData.rtsp_url} onChange={(e) => setFormData({...formData, rtsp_url: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">AI Detection Scenario</label>
                <select value={formData.scenario} onChange={(e) => setFormData({...formData, scenario: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="daytime">Daytime General</option>
                  <option value="night">Night Vision (CLAHE)</option>
                  <option value="zone_intrusion">Zone Intrusion</option>
                  <option value="vehicle_anpr">Vehicle ANPR</option>
                </select>
              </div>
              
              <div className="flex justify-end gap-3 mt-8">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={addCameraMutation.isPending} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors">
                  {addCameraMutation.isPending ? 'Saving...' : 'Save Camera'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
