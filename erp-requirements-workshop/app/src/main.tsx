import { render } from 'preact';
import { App } from './ui/App';
import './styles.css';

render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator && !(window as unknown as { claude?: unknown }).claude) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
