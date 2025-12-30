import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeManager } from '@/components/theme-manager';
import { ThemeSwitcher } from '@/components/theme-switcher';

const inter = Inter({ subsets: ['latin'] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const themeInitScript = `
(() => {
  try {
    const key = 'theme';
    const stored = localStorage.getItem(key);
    const validThemes = ['light', 'dark', 'dark-blue', 'black'];
    const systemDark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const resolved = validThemes.includes(stored)
      ? stored
      : stored === 'system' || !stored
        ? (systemDark ? 'dark' : 'light')
        : (systemDark ? 'dark' : 'light');

    document.documentElement.dataset.theme = resolved;
    document.documentElement.classList.toggle('dark', resolved !== 'light');
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`.trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: 'TaskTracker',
    template: '%s · TaskTracker',
  },

  description:
    'A capture-first thinking surface for notes, tasks, and emerging structure.',

  openGraph: {
    title: 'TaskTracker',
    description:
      'A capture-first thinking surface for notes, tasks, and emerging structure.',
    url: siteUrl,
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'TaskTracker',
    description:
      'A capture-first thinking surface for notes, tasks, and emerging structure.',
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={inter.className}>
        <ThemeManager />
        <div className="fixed right-4 top-4 z-50">
          <ThemeSwitcher />
        </div>
        {children}
      </body>
    </html>
  );
}
