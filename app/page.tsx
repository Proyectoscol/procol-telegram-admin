import { OpportunityBoard } from '@/components/OpportunityBoard';

export default function HomePage() {
  return (
    <div>
      <h1>Opportunities</h1>
      <p className="muted" style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Who to talk to today, and why. Recalculates from messages, wins, coach calls, follow-ups, and roadmap status.
      </p>
      <OpportunityBoard />
    </div>
  );
}
