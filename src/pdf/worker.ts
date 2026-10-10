// Module imports evaluate in order, so the polyfills are in place before pdf.js runs.
import '../polyfills'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
