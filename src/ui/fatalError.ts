export function showFatalError(message: string): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
    'justify-content:center', 'background:#000', 'color:#b0d0f0',
    'font-family:system-ui,sans-serif', 'font-size:1.2rem',
    'padding:2rem', 'text-align:center', 'z-index:9999',
  ].join(';');
  el.textContent = message;
  document.body.appendChild(el);
}
