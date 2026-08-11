import { AuditLogViewer } from "@/components/audit/AuditLogViewer";

/**
 * Admin dashboard: the audit-log viewer. This only ever renders for an
 * admin; `proxy.ts` has already rejected any other visitor to `/admin/*`
 * before this page loads.
 */
export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <AuditLogViewer />
    </div>
  );
}
