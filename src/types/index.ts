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
  latitude: number | null; // null apenas em registos manuais do backoffice
  longitude: number | null;
  gps_accuracy: number | null;
  client_timestamp: string | null;
  created_at: string;
  worksite_id: string | null;
  synced_offline: boolean;
  validated_at: string | null;
  validated_by: string | null;
  maintenance: boolean;
  manual: boolean;
  flags: Record<string, boolean>;
}

export interface Holiday {
  holiday_date: string;
  name: string;
}

export interface TimeEntryWithName extends TimeEntry {
  profiles: { full_name: string } | null;
  worksites: { name: string } | null;
}

export interface Worksite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  active: boolean;
  created_at: string;
}

// Registo feito sem rede, à espera de sincronização (vive no IndexedDB).
export interface PendingEntry {
  id: string;
  employee_id: string;
  entry_type: EntryType;
  entry_date: string;
  latitude: number;
  longitude: number;
  gps_accuracy: number | null;
  client_timestamp: string;
  photo: Blob;
}
