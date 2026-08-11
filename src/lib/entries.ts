import type { TimeEntry } from "@/types";

// Um registo é suspeito quando tem avisos que a gestão deve rever.
// "Fora da obra" deixa de contar depois de o registo ser marcado como
// manutenção (grandes zonas de intervenção justificam a distância).
export function isSuspicious(entry: TimeEntry): boolean {
  const flags = entry.flags ?? {};
  return (
    !!flags.low_gps_accuracy ||
    !!flags.clock_drift ||
    (!!flags.out_of_area && !entry.maintenance)
  );
}
