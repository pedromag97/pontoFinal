import { createClient } from "@/lib/supabase/server";
import type { Holiday } from "@/types";
import HolidayManager from "@/components/admin/HolidayManager";

export const dynamic = "force-dynamic";

export default async function FeriadosPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("holidays")
    .select("*")
    .order("holiday_date");

  return <HolidayManager initialHolidays={(data ?? []) as Holiday[]} />;
}
