import { clsx } from 'clsx';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassCard({ children, className }: GlassCardProps) {
  return <div className={clsx('glass-card p-5', className)}>{children}</div>;
}
