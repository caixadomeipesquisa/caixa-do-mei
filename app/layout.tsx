import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Caixa do MEI',
  description: 'Anote o que entra e o que sai, separe o seu salário e feche o caixa. Gratuito, parte de uma pesquisa de mestrado.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Caixa do MEI', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content', // com o teclado aberto, a tela encolhe e o botão fica visível
  themeColor: '#1f6b4f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
