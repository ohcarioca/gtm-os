import { getApiKeyStatus } from "./actions";
import { IntegrationsClient } from "./client";

export default async function IntegrationsPage() {
  const serperStatus = await getApiKeyStatus("serper");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Integrações</h1>
      <IntegrationsClient initialSerperStatus={serperStatus} />
    </div>
  );
}
