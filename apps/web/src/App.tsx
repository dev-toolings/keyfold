import { createBrowserRouter, createRoutesFromElements, Navigate, Route, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AiPage } from "@/pages/ai";
import { DashboardPage } from "@/pages/dashboard";
import { HealthPage } from "@/pages/health";
import { ItemDialog } from "@/pages/item-dialog";
import { SettingsPage } from "@/pages/settings";
import { UnlockPage } from "@/pages/unlock";
import { VaultPage } from "@/pages/vault";
import { isUnlocked } from "@/vault";
import { VaultProvider } from "@/vault-context";

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route index element={<Navigate to="/personal/dashboard" replace />} />
      <Route path="/en" element={<Navigate to="/personal/dashboard" replace />} />
      <Route path="/personal">
        <Route path="unlock" element={<UnlockPage />} />
        <Route element={<RequireUnlocked />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="ai" element={<AiPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="vault" element={<VaultPage />}>
            <Route path="new" element={<ItemDialog />} />
            <Route path=":id" element={<ItemDialog />} />
          </Route>
          <Route path="*" element={<Navigate to="/personal/dashboard" replace />} />
        </Route>
      </Route>
      {/* Any other path (/vault/..., a bookmark from before /personal) opens under /personal. */}
      <Route path="*" element={<ToPersonal />} />
    </>,
  ),
);

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
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
