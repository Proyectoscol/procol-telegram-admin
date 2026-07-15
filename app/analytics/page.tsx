import { Dashboard } from '@/components/Dashboard';

export default function AnalyticsPage() {
  return (
    <div>
      <h1>Analytics</h1>
      <p className="muted" style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Chat analytics and activity over time. Filter by one or more chats above.
      </p>
      <Dashboard />
    </div>
  );
}
