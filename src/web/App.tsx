import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth'
import { AppShell } from './shell/AppShell'
import { Loading } from './components/ui'
import { AdminPage } from './pages/AdminPage'
import { DevicePage } from './pages/DevicePage'
import { ForAgentPage } from './pages/ForAgentPage'
import { safeReturnPath } from './navigation'
import { isDesktop } from './platform'
import { NotFoundState } from './brand'
import { ThemeProvider, ToastProvider, TooltipProvider } from './ui'

// โค้ดเฉพาะ Desktop โหลดเมื่ออยู่ใน Tauri เท่านั้น
const DesktopShell = lazy(() => import('./desktop/DesktopShell').then((m) => ({ default: m.DesktopShell })))
import { InvitePage, LoginPage, SetupPage } from './pages/AuthPages'
import { ActivityPage } from './pages/ActivityPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { LegacyTasksRedirect, TasksPage } from './pages/TasksPage'
import { HomeRoute } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { AgentsPage } from './pages/AgentsPage'
import { SearchPage } from './pages/SearchPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { NewTaskPage } from './pages/NewTaskPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { TaskPadsPage } from './pads/TaskPadsPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 10_000 } },
})

function RequireAuth({ children }: { children: ReactNode }) {
  const { actor, bootstrapped, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!bootstrapped) return <Navigate to="/setup" replace />
  // Desktop: shell จัดการ sign-in เอง (device flow) ไม่มีหน้า password
  if (!actor) return isDesktop ? <Loading /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function RequireOwner({ children }: { children: ReactNode }) {
  const { actor } = useAuth()
  if (!actor?.isOwner) return <p className="error">Only the workspace owner can open this page.</p>
  return <>{children}</>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { actor, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (actor) return <Navigate to={safeReturnPath(location.state)} replace />
  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/setup" element={<PublicOnly><SetupPage /></PublicOnly>} />
      <Route path="/invite/:token" element={<PublicOnly><InvitePage /></PublicOnly>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<HomeRoute />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="list" element={<LegacyTasksRedirect view="list" />} />
        <Route path="my-tasks" element={<LegacyTasksRedirect view="my-work" />} />
        <Route path="pads" element={<TaskPadsPage />} />
        <Route path="pads/:padId" element={<TaskPadsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="tasks/new" element={<NewTaskPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="device" element={<DevicePage />} />
        <Route path="devices" element={<DevicePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="for-agent" element={<ForAgentPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<RequireOwner><AdminPage /></RequireOwner>} />
        <Route path="*" element={<NotFoundState />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
        {isDesktop ? (
          <Suspense fallback={<Loading />}>
            <DesktopShell>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </DesktopShell>
          </Suspense>
        ) : (
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        )}
            </BrowserRouter>
          </QueryClientProvider>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
