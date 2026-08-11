import { Suspense } from "react";
import { AuthPageClient } from "@/components/auth/AuthPageClient";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageClient />
    </Suspense>
  );
}
