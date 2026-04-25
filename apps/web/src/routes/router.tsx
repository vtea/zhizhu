import { createBrowserRouter, Navigate } from "react-router-dom";
import { ConsoleLayout } from "@/layouts/ConsoleLayout";
import { TenantConsoleShell } from "@/layouts/TenantConsoleShell";
import { AutomationRuleDetailPage } from "@/pages/automation/AutomationRuleDetailPage";
import { AutomationRulesLayout } from "@/pages/automation/AutomationRulesLayout";
import { AutomationRulesListPage } from "@/pages/automation/AutomationRulesListPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeviceBindingPage } from "@/pages/DeviceBindingPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { LoginPage } from "@/pages/LoginPage";
import { PlatformTenantsPage } from "@/pages/PlatformTenantsPage";
import { TenantManagementPage } from "@/pages/TenantManagementPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { RecommendedVideosPage } from "@/pages/RecommendedVideosPage";
import { StaffAccountsPage } from "@/pages/StaffAccountsPage";
import { AccessControlPage } from "@/pages/system-settings/AccessControlPage";
import { AuditEventsPage } from "@/pages/system-settings/AuditEventsPage";
import { OrganizationSettingsPage } from "@/pages/system-settings/OrganizationSettingsPage";
import { SystemSettingsLayout } from "@/pages/system-settings/SystemSettingsLayout";
import { SmtpSettingsPage } from "@/pages/system-settings/SmtpSettingsPage";
import { TaskCenterPage } from "@/pages/system-settings/TaskCenterPage";
import { AdPlacementsPage } from "@/pages/AdPlacementsPage";
import { VideosPage } from "@/pages/VideosPage";
import { RootOrAppRedirect } from "@/routes/RootOrAppRedirect";
import {
  RedirectUnknownToAutomationRulesList,
  RedirectUnknownToSystemSettingsOrg,
  RedirectUnknownToTenantDashboard,
} from "@/routes/routerRedirects";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/platform/tenants", element: <PlatformTenantsPage /> },
  {
    path: "/t/:tenantId",
    element: <TenantConsoleShell />,
    children: [
      {
        element: <ConsoleLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "staff-accounts", element: <StaffAccountsPage /> },
          {
            path: "automation-rules",
            element: <AutomationRulesLayout />,
            children: [
              { index: true, element: <AutomationRulesListPage /> },
              { path: "rules/:ruleId", element: <AutomationRuleDetailPage /> },
              { path: "*", element: <RedirectUnknownToAutomationRulesList /> },
            ],
          },
          { path: "leads", element: <LeadsPage /> },
          { path: "videos", element: <VideosPage /> },
          { path: "recommended-videos", element: <RecommendedVideosPage /> },
          { path: "ad-placements", element: <AdPlacementsPage /> },
          { path: "tenant-management", element: <TenantManagementPage /> },
          { path: "device-binding", element: <DeviceBindingPage /> },
          {
            path: "system-settings",
            element: <SystemSettingsLayout />,
            children: [
              { index: true, element: <Navigate to="organization" replace /> },
              { path: "organization", element: <OrganizationSettingsPage /> },
              { path: "tasks", element: <TaskCenterPage /> },
              { path: "access", element: <AccessControlPage /> },
              { path: "audit", element: <AuditEventsPage /> },
              { path: "mail", element: <SmtpSettingsPage /> },
              { path: "*", element: <RedirectUnknownToSystemSettingsOrg /> },
            ],
          },
          { path: "*", element: <RedirectUnknownToTenantDashboard /> },
        ],
      },
    ],
  },
  { path: "/", element: <RootOrAppRedirect /> },
  { path: "*", element: <RootOrAppRedirect /> },
]);
