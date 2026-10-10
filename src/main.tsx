import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadPdfjs } from './pdf/pdfjs'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fetch the PDF libraries while the user is still choosing files.
const prefetch = () => {
  void loadPdfjs()
  void import('./pdf/export')
}
if ('requestIdleCallback' in window) requestIdleCallback(prefetch, { timeout: 3000 })
else setTimeout(prefetch, 1500)
