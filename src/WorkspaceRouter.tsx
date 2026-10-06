import { lazy, Suspense, useEffect, useState } from 'react';

const CityWorkspace = lazy(() => import('./App'));
const ProductionWorkspace = lazy(() => import('./ProductionWorkspace'));

export default function WorkspaceRouter() {
  const [production, setProduction] = useState(() => window.location.hash === '#production');
  useEffect(() => {
    const navigate = () => setProduction(window.location.hash === '#production');
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  return <Suspense fallback={<main aria-live="polite" style={{ padding: 32 }}>正在加载工作区…</main>}>
    {production ? <ProductionWorkspace /> : <CityWorkspace />}
  </Suspense>;
}
