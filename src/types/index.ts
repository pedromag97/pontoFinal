export type Role = "employee" | "admin";
export type EntryType = "entrada" | "saida_almoco" | "volta_almoco" | "saida";

export interface LunchScheduleDay {
  weekday: number; // 0 = domingo … 6 = sábado
  lunch_required: boolean;
}

export interface Profile {
  id: string;
  username: string | null;
  full_name: string;
  role: Role;
  active: boolean;
  preferred_language: string;
  consent_given_at: string | null;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  entry_type: EntryType;
  entry_date: string;
  photo_path: string | null;
  latitude: number;
  longitude: number;
  gps_accuracy: number | null;
  client_timestamp: string | null;
  created_at: string;
  flags: Record<string, boolean>;
}

export interface TimeEntryWithName extends TimeEntry {
  profiles: { full_name: string } | null;
}
