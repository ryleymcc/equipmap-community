import { getCachedDashboardData } from './cacheUtils.js';

/**
 * Calculates pg_trgm compatible trigram similarity between two strings.
 * Pads the strings with leading and trailing spaces and extracts 3-character substrings.
 */
export function calculateTrigramSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1.length < 3 || str2.length < 3) return 0;

  const s1 = `  ${str1.toLowerCase()} `;
  const s2 = `  ${str2.toLowerCase()} `;

  const triMap1 = Object.create(null);
  let count1 = 0;
  for (let i = 0; i <= s1.length - 3; i++) {
    const tri = s1.substring(i, i + 3);
    triMap1[tri] = (triMap1[tri] || 0) + 1;
    count1++;
  }

  const triMap2 = Object.create(null);
  let count2 = 0;
  for (let i = 0; i <= s2.length - 3; i++) {
    const tri = s2.substring(i, i + 3);
    triMap2[tri] = (triMap2[tri] || 0) + 1;
    count2++;
  }

  let intersection = 0;
  for (const tri in triMap1) {
    if (triMap2[tri]) {
      intersection += Math.min(triMap1[tri], triMap2[tri]);
    }
  }

  const union = count1 + count2 - intersection;
  return union <= 0 ? 0 : intersection / union;
}

/**
 * Evaluates an entity against a search query and returns a score, or null if no match.
 * Mirrors the Postgres backend scoring tiers while adding fuzzy typo tolerance.
 */
export function scoreEntity(query, entity) {
  if (!query || !entity) return null;
  const rawQ = query.trim();
  if (!rawQ) return null;

  const lowerQ = rawQ.toLowerCase();
  const cleanQ = lowerQ.replace(/[^a-z0-9]/g, '');

  const name = entity.name || entity.title || entity.full_name || entity.username || '';
  const desc = [
    entity.description,
    entity.site_name,
    entity.floorplan_name,
    entity.email,
    entity.trade,
    entity.role
  ].filter(Boolean).join(' ');

  const lowerName = name.toLowerCase();
  const lowerDesc = desc.toLowerCase();

  const cleanName = lowerName.replace(/[^a-z0-9]/g, '');
  const cleanDesc = lowerDesc.replace(/[^a-z0-9]/g, '');

  // 1. Exact match on name
  if (lowerName === lowerQ) {
    return 1000.0;
  }

  // Fast path for substring in name
  if (lowerName.includes(lowerQ)) {
    // 2. Word boundary match on name (e.g. "101" matching "Room 101" or "Pump 101-A")
    const escapedQ = lowerQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`(^|[^a-z0-9])${escapedQ}($|[^a-z0-9])`, 'i');
    if (wordBoundaryRegex.test(lowerName)) {
      if (lowerName.startsWith(lowerQ)) {
        return 900.0 - (lowerName.length * 0.1);
      }
      return 800.0 - (lowerName.length * 0.1);
    }

    // 3. Prefix match on name
    if (lowerName.startsWith(lowerQ)) {
      return 700.0 - (lowerName.length * 0.1);
    }

    // 4. Substring match on name
    return 600.0 - (lowerName.length * 0.1);
  }

  // 5. Clean prefix match on name (e.g. "AHU1" matching "AHU-1")
  if (cleanQ && cleanName.startsWith(cleanQ)) {
    return 500.0 - (cleanName.length * 0.1);
  }

  // 6. Clean substring match on name
  if (cleanQ && cleanName.includes(cleanQ)) {
    return 400.0 - (cleanName.length * 0.1);
  }

  // 7. Substring match in description
  if (lowerDesc && lowerDesc.includes(lowerQ)) {
    return 300.0 - (lowerDesc.length * 0.1);
  }

  // 8. Clean substring match in description
  if (cleanQ && cleanDesc && cleanDesc.includes(cleanQ)) {
    return 200.0 - (cleanDesc.length * 0.1);
  }

  // 9. Fuzzy Trigram similarity match on name (only for queries >= 3 chars to prevent lag on 1st/2nd character)
  if (lowerQ.length >= 3) {
    const sim = calculateTrigramSimilarity(lowerQ, lowerName);
    if (sim >= 0.3) {
      return 100.0 + (sim * 10);
    }

    // 10. Fuzzy similarity on description for short descriptions
    if (lowerDesc && lowerDesc.length < 80) {
      const descSim = calculateTrigramSimilarity(lowerQ, lowerDesc);
      if (descSim >= 0.4) {
        return 50.0 + (descSim * 10);
      }
    }
  }

  return null;
}

/**
 * Searches across rooms and equipment entirely in the client.
 * Merges localStorage cache, site floorplans, and current in-memory items.
 */
export function searchClientEntities(query, { rooms = [], equipment = [], siteFloorplans = [], tickets = [] } = {}) {
  if (!query || !query.trim()) return [];

  // Deduplicate and aggregate all rooms
  const roomsMap = new Map();
  // 1. From dashboard localStorage cache
  const cachedRooms = getCachedDashboardData('rooms');
  if (Array.isArray(cachedRooms)) {
    for (const r of cachedRooms) {
      if (r && r.id) roomsMap.set(r.id, { ...r, type: 'room' });
    }
  }
  // 2. From siteFloorplans if present
  if (Array.isArray(siteFloorplans)) {
    for (const fp of siteFloorplans) {
      if (Array.isArray(fp.rooms)) {
        for (const r of fp.rooms) {
          if (r && r.id) roomsMap.set(r.id, { ...r, floorplan_id: r.floorplan_id || fp.id, type: 'room' });
        }
      }
    }
  }
  // 3. Current active floorplan rooms (latest optimistic state)
  if (Array.isArray(rooms)) {
    for (const r of rooms) {
      if (r && r.id) roomsMap.set(r.id, { ...r, type: 'room' });
    }
  }

  // Deduplicate and aggregate all equipment
  const equipmentMap = new Map();
  // 1. From dashboard localStorage cache
  const cachedEquipment = getCachedDashboardData('equipment');
  if (Array.isArray(cachedEquipment)) {
    for (const e of cachedEquipment) {
      if (e && e.id) equipmentMap.set(e.id, { ...e, type: 'equipment' });
    }
  }
  // 2. From siteFloorplans if present
  if (Array.isArray(siteFloorplans)) {
    for (const fp of siteFloorplans) {
      if (Array.isArray(fp.equipment)) {
        for (const e of fp.equipment) {
          if (e && e.id) equipmentMap.set(e.id, { ...e, floorplan_id: e.floorplan_id || fp.id, type: 'equipment' });
        }
      }
    }
  }
  // 3. Current active floorplan equipment (latest optimistic state)
  if (Array.isArray(equipment)) {
    for (const e of equipment) {
      if (e && e.id) equipmentMap.set(e.id, { ...e, type: 'equipment' });
    }
  }

  const results = [];

  for (const room of roomsMap.values()) {
    const score = scoreEntity(query, room);
    if (score !== null) {
      results.push({
        id: room.id,
        type: 'room',
        name: room.name,
        description: room.description || '',
        floorplan_id: room.floorplan_id,
        x_coordinate: room.x_coordinate,
        y_coordinate: room.y_coordinate,
        color: null,
        score
      });
    }
  }

  for (const equip of equipmentMap.values()) {
    const score = scoreEntity(query, equip);
    if (score !== null) {
      results.push({
        id: equip.id,
        type: 'equipment',
        name: equip.name,
        description: equip.description || '',
        floorplan_id: equip.floorplan_id,
        x_coordinate: equip.x_coordinate,
        y_coordinate: equip.y_coordinate,
        color: equip.color || null,
        score
      });
    }
  }

  // Optional tickets if passed or cached
  if (Array.isArray(tickets) && tickets.length > 0) {
    for (const t of tickets) {
      const score = scoreEntity(query, t);
      if (score !== null) {
        results.push({
          id: t.id,
          type: 'ticket',
          name: t.title || t.name,
          title: t.title || t.name,
          description: t.description || '',
          floorplan_id: t.floorplan_id,
          x_coordinate: t.x_coordinate,
          y_coordinate: t.y_coordinate,
          score
        });
      }
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);

  return results;
}
