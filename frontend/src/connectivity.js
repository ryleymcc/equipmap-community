// A portable server remains reachable on loopback with all network adapters off.
export const isServerReachable = () => import.meta.env.VITE_PORTABLE === 'true' || navigator.onLine;
