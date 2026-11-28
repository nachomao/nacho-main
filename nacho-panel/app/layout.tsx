import { Analytics } from '@vercel/analytics/next'
import { headers } from 'next/headers'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Outfit } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/app-shell'
import { WindowSurface } from '@/components/window-surface'
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
  title: 'NachoPanel — Windows 设备控制面板',
  description: '部署并管理 Windows 控制服务、Agent、任务、日志与设备状态。',
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
  // 桌面壳窗口透明并用大圆角裁切四角；浏览器预览保持直角铺满视口。
  const desktopShell = /Electron\//.test((await headers()).get('user-agent') ?? '')
  const theme = localSettings.settings.theme
  const reduceMotion = localSettings.settings.reduceMotion

  return (
    <html
      lang="zh-CN"
      data-desktop-shell={desktopShell ? '' : undefined}
      data-theme={theme === 'blue' ? undefined : theme}
      data-reduce-motion={reduceMotion ? 'true' : undefined}
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} bg-background`}
      style={{ height: '100%', overflow: 'hidden' }}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" style={{ height: '100%', overflow: 'hidden', overflowX: 'hidden' }}>
        {!localSettings.exists && (
          <script dangerouslySetInnerHTML={{ __html: legacyThemeInitScript }} />
        )}
        <LocalSettingsProvider initialSnapshot={localSettings}>
          <ThemeProvider>
            <ConfirmDialogProvider>
              <WindowSurface>
                <AppShell>{children}</AppShell>
              </WindowSurface>
            </ConfirmDialogProvider>
          </ThemeProvider>
        </LocalSettingsProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
