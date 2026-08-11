import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Appointment Portal
      </h1>
      <p className="max-w-md text-gray-600">
        Book, manage, and run appointments across patient, provider, and
        admin workspaces.
      </p>
      <Link
        href="/login"
        className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
      >
        Log in
      </Link>
    </div>
  );
}
