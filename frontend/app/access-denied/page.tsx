import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="text-sm text-gray-600">
        Your account doesn&apos;t have access to that page.
      </p>
      <Link href="/login" className="text-sm underline">
        Switch account
      </Link>
    </div>
  );
}
