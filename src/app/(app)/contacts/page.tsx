import { createClient } from "@/lib/supabase/server";
import { ContactsTable } from "@/components/contacts-table";
import type { Lead } from "@/lib/types/database";

export default async function ContactsPage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Contatos</h2>
        <p className="text-slate-500">Gerencie seus leads</p>
      </div>
      <ContactsTable leads={(leads as Lead[]) ?? []} />
    </div>
  );
}
