"use client";

import { useRouter } from "next/navigation";
import { clearAuth } from "@/lib/auth";

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();

  function handleLogout() {
    clearAuth();
    router.replace("/login");
  }

  return (
    <button type="button" onClick={handleLogout} className={className}>
      Logout
    </button>
  );
}
