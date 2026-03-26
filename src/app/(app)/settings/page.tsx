import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCompanyProfile } from "./actions";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyProfile } from "@/lib/types/database";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const typedProfile = companyProfile as CompanyProfile | null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Configurações</h1>

      <Card className="rounded-xl shadow-sm border-slate-200 p-8">
        <CardContent className="p-0 space-y-10">
          {/* Perfil da Empresa */}
          <section>
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-6">
              Perfil da Empresa
            </h2>

            {typedProfile && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 mb-6">
                <p>Perfil salvo — {typedProfile.name}</p>
                {typedProfile.icp_company_types && typedProfile.icp_company_types.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="text-green-600 text-xs">Tipos de empresa:</span>
                    {typedProfile.icp_company_types.map((type: string) => (
                      <span key={type} className="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                        {type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <form action={saveCompanyProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="company_name">Nome da Empresa</Label>
                  <Input
                    id="company_name"
                    name="company_name"
                    placeholder="Ex: Debtify"
                    defaultValue={typedProfile?.name ?? ""}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sector">Setor</Label>
                  <Input
                    id="sector"
                    name="sector"
                    placeholder="Ex: Cobrança digital"
                    defaultValue={typedProfile?.sector ?? ""}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="value_proposition">Proposta de Valor</Label>
                <Textarea
                  id="value_proposition"
                  name="value_proposition"
                  placeholder="Ex: Plataforma de recuperação de crédito com IA"
                  defaultValue={typedProfile?.value_proposition ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="icp">Perfil do Cliente Ideal (ICP)</Label>
                <Textarea
                  id="icp"
                  name="icp"
                  placeholder="Ex: Empresas de telecom com +500 clientes inadimplentes"
                  defaultValue={typedProfile?.icp ?? ""}
                  required
                />
              </div>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {typedProfile ? "Atualizar Perfil" : "Salvar Perfil"}
              </Button>
            </form>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
