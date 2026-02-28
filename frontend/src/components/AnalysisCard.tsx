import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface AnalysisCardProps {
  icon: string;
  title: string;
  metric: string;
  subtitle?: string;
  to: string;
  children?: ReactNode;
}

export default function AnalysisCard({ icon, title, metric, subtitle, to, children }: AnalysisCardProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(to)}
      className="group bg-surface rounded-xl border border-border p-5 hover:border-accent-500/50 transition-all cursor-pointer relative"
    >
      {/* Arrow top-right on hover */}
      <span className="absolute top-4 right-4 text-muted/30 group-hover:text-accent-400 transition-colors text-lg">
        →
      </span>

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-sm text-muted">{title}</span>
      </div>

      {/* Metric */}
      <div className="mb-1">
        <span className="text-2xl font-bold text-white">{metric}</span>
      </div>
      {subtitle && <p className="text-xs text-muted mb-3">{subtitle}</p>}

      {/* Mini chart area */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
