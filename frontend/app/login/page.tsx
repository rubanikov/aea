import Link from "next/link";
import { DemoRoleSwitcher } from "@/components/auth/DemoRoleSwitcher";

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-2 text-sm text-gray-600">
          Registration and login are coming soon.
        </p>
      </div>
      <DemoRoleSwitcher />
      <Link href="/" className="text-sm underline">
        Back home
      </Link>
    </div>
  );
}
