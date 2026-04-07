/**
 * API helpers for Meetings.
 *
 * All endpoints are prefixed with /v1/meetings/.
 */

import { apiGet, apiPost, apiPatch } from '@/shared/lib/api';

/* -- Types ----------------------------------------------------------------- */

export type MeetingType =
  | 'progress'
  | 'design'
  | 'safety'
  | 'subcontractor'
  | 'kickoff'
  | 'closeout';

export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export type AttendeeStatus = 'present' | 'absent' | 'excused';

export interface Attendee {
  id: string;
  name: string;
  role: string;
  status: AttendeeStatus;
}

export interface AgendaItem {
  id: string;
  title: string;
  presenter: string;
  duration_minutes: number;
  notes: string;
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string;
  due_date: string;
  completed: boolean;
}

export interface Meeting {
  id: string;
  project_id: string;
  meeting_number: number;
  title: string;
  meeting_type: MeetingType;
  date: string;
  location: string;
  chairperson: string;
  status: MeetingStatus;
  attendees: Attendee[];
  agenda_items: AgendaItem[];
  action_items: ActionItem[];
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingFilters {
  project_id?: string;
  meeting_type?: MeetingType | '';
  status?: MeetingStatus | '';
}

export interface CreateMeetingPayload {
  project_id: string;
  title: string;
  meeting_type: MeetingType;
  date: string;
  location?: string;
  chairperson?: string;
  attendees?: string[];
}

/* -- API Functions --------------------------------------------------------- */

export async function fetchMeetings(filters?: MeetingFilters): Promise<Meeting[]> {
  const params = new URLSearchParams();
  if (filters?.project_id) params.set('project_id', filters.project_id);
  if (filters?.meeting_type) params.set('meeting_type', filters.meeting_type);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiGet<Meeting[]>(`/v1/meetings${qs ? `?${qs}` : ''}`);
}

export async function createMeeting(data: CreateMeetingPayload): Promise<Meeting> {
  return apiPost<Meeting>('/v1/meetings', data);
}

export async function updateMeeting(
  id: string,
  data: Partial<CreateMeetingPayload>,
): Promise<Meeting> {
  return apiPatch<Meeting>(`/v1/meetings/${id}`, data);
}

export async function completeMeeting(id: string): Promise<Meeting> {
  return apiPost<Meeting>(`/v1/meetings/${id}/complete`);
}
