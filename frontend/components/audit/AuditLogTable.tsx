import { formatAuditTimestamp } from "@/lib/audit/format";
import type { AuditLogEntry } from "@/lib/audit/types";

interface AuditLogTableProps {
  entries: AuditLogEntry[];
}

/**
 * Read-only audit log table. Real `<table>` markup (not a div-grid) so
 * screen readers get row/column semantics for free, with `<th scope="col">`
 * headers.
 */
export function AuditLogTable({ entries }: AuditLogTableProps) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Audit log entries</caption>
      <thead>
        <tr className="border-b border-gray-300">
          <th scope="col" className="py-2 pr-4 font-medium">
            Timestamp (UTC)
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Actor
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Action
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Target
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className="border-b border-gray-100">
            <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs">
              <time dateTime={entry.timestamp}>
                {formatAuditTimestamp(entry.timestamp)}
              </time>
            </td>
            <td className="py-2 pr-4">{entry.actor ?? "System"}</td>
            <td className="py-2 pr-4">{entry.action}</td>
            <td className="py-2 pr-4">
              {entry.target_type} #{entry.target_id}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
