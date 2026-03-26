import { createClient } from "@/lib/supabase/server";
import { ChatDashboard } from "@/components/chat-dashboard";
import {
  getApprovedCompaniesCount,
  getDashboardCompanyProfile,
  getDashboardApprovedCompanies,
} from "./actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const firstName = user?.user_metadata?.full_name?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? "usuario";

  const [approvedCount, companyProfile, approvedCompanies] = await Promise.all([
    getApprovedCompaniesCount(),
    getDashboardCompanyProfile(),
    getDashboardApprovedCompanies(),
  ]);

  return (
    <ChatDashboard
      firstName={firstName}
      approvedCount={approvedCount}
      companyProfile={companyProfile}
      approvedCompanies={approvedCompanies}
    />
  );
}
