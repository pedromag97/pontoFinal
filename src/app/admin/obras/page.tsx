import { createClient } from "@/lib/supabase/server";
import type { Worksite } from "@/types";
import WorksiteManager from "@/components/admin/WorksiteManager";

export const dynamic = "force-dynamic";

export default async function ObrasPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("worksites")
    .select("*")
    .order("active", { ascending: false })
    .order("name");

  return <WorksiteManager initialWorksites={(data ?? []) as Worksite[]} />;
}
