import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kiraa — Agent de location de véhicules',
  description:
    'Agent agentique de location de véhicules : éligibilité, tarification déterministe et politiques commerciales.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen text-slate-900 antialiased">{children}</body>
    </html>
  );
}
