import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardPage } from "@/pages/dashboard";
import { HealthPage } from "@/pages/health";
import { ItemSheet } from "@/pages/item-sheet";
import { SettingsPage } from "@/pages/settings";
import { UnlockPage } from "@/pages/unlock";
import { VaultPage } from "@/pages/vault";
import { isUnlocked } from "@/vault";
import { VaultProvider } from "@/vault-context";

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route index element={<Navigate to="/personal/dashboard" replace />} />
          <Route path="/en" element={<Navigate to="/personal/dashboard" replace />} />
          <Route path="/personal">
            <Route path="unlock" element={<UnlockPage />} />
            <Route element={<RequireUnlocked />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="health" element={<HealthPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="vault" element={<VaultPage />}>
                <Route path="new" element={<ItemSheet />} />
                <Route path=":id" element={<ItemSheet />} />
              </Route>
              <Route path="*" element={<Navigate to="/personal/dashboard" replace />} />
            </Route>
          </Route>
          {/* Any other path (/vault/..., a bookmark from before /personal) opens under /personal. */}
          <Route path="*" element={<ToPersonal />} />
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}

function ToPersonal() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/personal${pathname}${search}`} replace />;
}

/** Locked (first load, reload, lock, expired session): go to /personal/unlock, then come back here. */
function RequireUnlocked() {
  const location = useLocation();
  if (!isUnlocked()) return <Navigate to="/personal/unlock" replace state={{ from: location }} />;
  return (
    <VaultProvider>
      <AppShell />
    </VaultProvider>
  );
}
