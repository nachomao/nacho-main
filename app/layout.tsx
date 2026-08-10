import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Outfit } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/app-shell'
import { LocalSettingsProvider } from '@/components/local-settings-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog'
import { readLocalSettings } from '@/lib/local-settings-store'

const legacyThemeInitScript = `(function(){try{var t=localStorage.getItem("nacho-theme");if(t&&t!=="blue")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`

export const dynamic = 'force-dynamic'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
const outfit = Outfit({ variable: '--font-outfit', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Token Overview — Crypto Dashboard',
  description: 'Crypto portfolio and token overview dashboard',
  generator: 'v0.app',
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#000000',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const localSettings = await readLocalSettings()
  const theme = localSettings.settings.theme

  return (
    <html
      lang="en"
      data-theme={theme === 'blue' ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} bg-background`}
      style={{ height: '100%', overflow: 'hidden' }}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" style={{ height: '100%', overflow: 'hidden' }}>
        {!localSettings.exists && (
          <script dangerouslySetInnerHTML={{ __html: legacyThemeInitScript }} />
        )}
        <LocalSettingsProvider initialSnapshot={localSettings}>
          <ThemeProvider>
            <ConfirmDialogProvider>
              <AppShell>{children}</AppShell>
            </ConfirmDialogProvider>
          </ThemeProvider>
        </LocalSettingsProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
