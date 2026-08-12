import { AuthGate } from "@/components/AuthGate";
import { ManageMonitors } from "@/components/ManageMonitors";

export default function ManagePage() {
  return (
    <AuthGate>
      <ManageMonitors />
    </AuthGate>
  );
}
