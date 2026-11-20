// Resolve saved selections against the current list of accessible sites.
export function selectDashboardSite(sites, preferredSiteId, activeSiteId) {
  const findSite = id => sites.find(site => String(site.id) === String(id));
  return findSite(preferredSiteId) || findSite(activeSiteId) || sites[0] || null;
}
