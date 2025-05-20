"use client";
import { LogOutIcon } from "lucide-react";
import { useAuth } from "./AuthProvider";

export default function LogoutButton() {
  const { signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    // Clear the authentication cookie
    document.cookie = "sb:token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    window.location.href = "/login";
  };

  return (
    <button
      onClick={handleLogout}
      className="w-full p-2 gap-2 text-red-600 flex items-center"
    >
      <LogOutIcon className="w-4 h-4 mr-2" />
      Logout
    </button>
  );
}
