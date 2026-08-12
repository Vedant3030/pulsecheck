import { AuthGate } from "@/components/AuthGate";
import { MonitorWall } from "@/components/MonitorWall";

export default function MonitorWallPage() {
  return (
    <AuthGate>
      <MonitorWall />
    </AuthGate>
  );
}
