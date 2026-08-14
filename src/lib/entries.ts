import type { TimeEntry } from "@/types";

// Um registo é suspeito quando tem avisos que a gestão deve rever.
// O "fora da obra" desaparece quando o backoffice lhe atribui uma obra
// à mão (tipicamente uma obra móvel).
export function isSuspicious(entry: TimeEntry): boolean {
  const flags = entry.flags ?? {};
  return (
    !!flags.low_gps_accuracy ||
    !!flags.clock_drift ||
    !!flags.out_of_area ||
    !!flags.bad_client_clock
  );
}
