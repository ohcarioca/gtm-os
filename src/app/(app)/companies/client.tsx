"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileSpreadsheet } from "lucide-react";
import { CompanyList } from "@/components/company-list";
import { AddCompanyModal } from "@/components/add-company-modal";
import { ImportCompaniesModal } from "@/components/import-companies-modal";
import type { ProspectCompany } from "@/lib/types/database";

interface CompaniesClientProps {
  companies: ProspectCompany[];
}

export function CompaniesClient({ companies }: CompaniesClientProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Empresas</h2>

      <CompanyList
        companies={companies}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar Empresa
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Importar CSV/XLSX
            </Button>
          </>
        }
      />

      <AddCompanyModal open={addOpen} onOpenChange={setAddOpen} />
      <ImportCompaniesModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
