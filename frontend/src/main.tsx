import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { ThemeProvider, useTheme } from './lib/theme'
import { LanguageProvider, useLanguage } from './lib/i18n'
import './index.css'

/** Toaster styled to the palette; re-renders with the resolved theme and the writing direction. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  const { dir } = useLanguage()
  const dark = resolvedTheme === 'dark'
  return (
    <Toaster
      position={dir === 'rtl' ? 'top-left' : 'top-right'}
      gutter={8}
      toastOptions={{
        duration: 3500,
        style: {
          direction: dir,
          background: dark ? '#1d141e' : '#ffffff',
          color: dark ? '#f7f3f8' : '#1d141e',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : '#ece5ed'}`,
          boxShadow: dark ? '0 18px 40px -14px rgba(0,0,0,0.72)' : '0 10px 24px -10px rgba(29,20,30,0.16)',
          borderRadius: '10px',
          padding: '10px 14px',
          fontSize: '13px',
          fontWeight: 500,
          fontFamily: 'Heebo, Inter, system-ui, sans-serif',
          maxWidth: '420px',
        },
        success: {
          iconTheme: { primary: '#10b981', secondary: dark ? '#1d141e' : '#ffffff' },
        },
        error: {
          iconTheme: { primary: '#f43f5e', secondary: dark ? '#1d141e' : '#ffffff' },
          duration: 5000,
        },
        loading: {
          iconTheme: { primary: '#c62c85', secondary: dark ? '#1d141e' : '#ffffff' },
        },
      }}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <BrowserRouter>
          <App />
          <ThemedToaster />
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
)
