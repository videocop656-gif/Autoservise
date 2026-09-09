import { PageContainer } from '../components/layout/PageContainer'
import { PageHeader } from '../components/layout/PageHeader'

// Prompt 19 (Frontend Foundation + App Shell) — deliberately a placeholder.
// Prompt 14 already built a real, working analytics dashboard here; per an
// explicit product decision made when reviewing this stage, it is reset to
// a clean placeholder now so the real dashboard can be rebuilt in the new
// visual system as its own dedicated stage, rather than mechanically
// reskinning the old one. The backend it depended on (analyticsService.ts,
// GET /api/dashboard) is untouched — see the Final Report.
export default function DashboardPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Dashboard" subtitle="Overview of your service activity" />
      <p className="text-sm text-muted-foreground">Dashboard content will be implemented in the next step.</p>
    </PageContainer>
  )
}
