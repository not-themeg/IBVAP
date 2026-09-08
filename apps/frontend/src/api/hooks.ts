import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
import { Camera, Incident, ANPRObservationRecord } from '../types';

export const useCameras = () => {
  return useQuery({
    queryKey: ['cameras'],
    queryFn: async () => {
      const { data } = await apiClient.get<Camera[]>('/cameras/');
      return data;
    },
  });
};

export const useIncidents = (limit = 50, unacknowledgedOnly = false) => {
  return useQuery({
    queryKey: ['incidents', limit, unacknowledgedOnly],
    queryFn: async () => {
      const { data } = await apiClient.get<Incident[]>('/incidents', {
        params: { limit, unacknowledged_only: unacknowledgedOnly }
      });
      return data;
    },
    refetchInterval: 5000 // Auto refresh every 5 seconds for dashboard
  });
};

export const useANPRObservations = (limit = 20) => {
  return useQuery({
    queryKey: ['anpr_observations', limit],
    queryFn: async () => {
      const { data } = await apiClient.get<ANPRObservationRecord[]>('/anpr/observations', {
        params: { limit }
      });
      return data;
    },
    refetchInterval: 5000
  });
};

export const useAcknowledgeIncident = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (incidentId: string) => {
      const { data } = await apiClient.post(`/incidents/${incidentId}/acknowledge`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
};

export const useUpdateIncidentStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ incidentId, status }: { incidentId: string; status: string }) => {
      const { data } = await apiClient.post(`/incidents/${incidentId}/status`, { status });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
};

export const useSubmitFeedback = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      incidentId,
      label,
      notes
    }: {
      incidentId: string;
      label: 'TRUE_INTRUSION' | 'FALSE_ALARM' | 'UNSURE';
      notes?: string;
    }) => {
      const { data } = await apiClient.post('/events/feedback', {
        incident_id: incidentId,
        label,
        notes
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
};

