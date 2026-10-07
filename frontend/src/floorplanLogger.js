import { trackPageLoadTime } from './metrics';

class FloorplanTimingLogger {
  constructor() {
    this.currentSwitch = null;
  }

  /**
   * Start timing a floorplan switch when user initiates navigation.
   */
  startSwitch(floorplanId, floorplanName = null, source = 'navigation') {
    if (!floorplanId) return;
    const startTime = performance.now();
    const fpIdStr = String(floorplanId);

    // If an existing switch is already in flight for the same floorplan and not completed, keep it
    if (this.currentSwitch && this.currentSwitch.floorplanId === fpIdStr && !this.currentSwitch.completed) {
      if (floorplanName) this.currentSwitch.floorplanName = floorplanName;
      return;
    }

    this.currentSwitch = {
      floorplanId: fpIdStr,
      floorplanName: floorplanName || `ID ${floorplanId}`,
      source,
      startTime,
      dataStartTime: startTime,
      dataEndTime: null,
      dataSource: null,
      dataDetails: null,
      assetStartTime: null,
      assetDocParsedTime: null,
      assetRenderEndTime: null,
      assetType: null,
      assetUrl: null,
      totalTime: null,
      completed: false
    };

    console.log(
      `%c⏱️ [Floorplan Switch] Started -> "${this.currentSwitch.floorplanName}" (ID: ${floorplanId}) [Trigger: ${source}]`,
      'color: #8b5cf6; font-weight: bold; font-size: 11px;'
    );
  }

  /**
   * Ensure an active switch tracker exists (e.g. for direct URL landing or route changes).
   */
  ensureSwitch(floorplanId, floorplanName = null, source = 'direct') {
    if (!floorplanId) return;
    const fpIdStr = String(floorplanId);
    if (!this.currentSwitch || this.currentSwitch.floorplanId !== fpIdStr || this.currentSwitch.completed) {
      this.startSwitch(floorplanId, floorplanName, source);
    }
  }

  /**
   * Record when floorplan data fetching or cache lookup begins.
   */
  recordDataStart(floorplanId) {
    this.ensureSwitch(floorplanId);
    if (this.currentSwitch && this.currentSwitch.floorplanId === String(floorplanId)) {
      this.currentSwitch.dataStartTime = performance.now();
    }
  }

  /**
   * Record when floorplan data (rooms, equipment, tickets) is loaded.
   */
  recordDataSuccess(floorplanId, { source = 'unknown', roomsCount = 0, equipmentCount = 0, ticketsCount = 0, floorplanName = null } = {}) {
    this.ensureSwitch(floorplanId, floorplanName);
    if (this.currentSwitch && this.currentSwitch.floorplanId === String(floorplanId)) {
      const now = performance.now();
      this.currentSwitch.dataEndTime = now;
      this.currentSwitch.dataSource = source;
      if (floorplanName && (!this.currentSwitch.floorplanName || this.currentSwitch.floorplanName.startsWith('ID '))) {
        this.currentSwitch.floorplanName = floorplanName;
      }
      this.currentSwitch.dataDetails = {
        rooms: roomsCount,
        equipment: equipmentCount,
        tickets: ticketsCount
      };

      const duration = (now - this.currentSwitch.dataStartTime).toFixed(1);
      console.log(
        `%c📦 [Floorplan Data] Loaded in ${duration}ms [Source: ${source}] (Rooms: ${roomsCount}, Equipment: ${equipmentCount}, Tickets: ${ticketsCount})`,
        'color: #059669; font-weight: bold; font-size: 11px;'
      );
    }
  }

  /**
   * Record when floorplan asset (PDF, Image, 3D GLB) fetching/rendering starts.
   */
  recordAssetStart(floorplanId, { fileType = 'unknown', filePath = '' } = {}) {
    this.ensureSwitch(floorplanId);
    if (this.currentSwitch && this.currentSwitch.floorplanId === String(floorplanId)) {
      // Only set if not already set for this switch
      if (!this.currentSwitch.assetStartTime) {
        this.currentSwitch.assetStartTime = performance.now();
        this.currentSwitch.assetType = fileType;
        this.currentSwitch.assetUrl = filePath;

        console.log(
          `%c🎨 [Floorplan Asset] Loading ${fileType.toUpperCase()} asset (${filePath})...`,
          'color: #0284c7; font-size: 11px;'
        );
      }
    }
  }

  /**
   * Record when PDF document file has been parsed by pdf.js worker.
   */
  recordPdfDocParsed(floorplanId, { numPages = 1 } = {}) {
    if (this.currentSwitch && this.currentSwitch.floorplanId === String(floorplanId) && this.currentSwitch.assetStartTime) {
      if (!this.currentSwitch.assetDocParsedTime) {
        const now = performance.now();
        this.currentSwitch.assetDocParsedTime = now;
        const parseDuration = (now - this.currentSwitch.assetStartTime).toFixed(1);
        console.log(
          `%c📄 [Floorplan Asset] PDF parsed (${numPages} page${numPages > 1 ? 's' : ''}) in ${parseDuration}ms`,
          'color: #0284c7; font-size: 11px;'
        );
      }
    }
  }

  /**
   * Record when asset rendering onto screen/canvas has succeeded.
   */
  recordAssetSuccess(floorplanId, { fileType = null, extraInfo = '' } = {}) {
    if (this.currentSwitch && this.currentSwitch.floorplanId === String(floorplanId)) {
      if (this.currentSwitch.completed) return; // already finished

      const now = performance.now();
      this.currentSwitch.assetRenderEndTime = now;
      if (fileType) this.currentSwitch.assetType = fileType;

      const totalAssetDuration = this.currentSwitch.assetStartTime
        ? (now - this.currentSwitch.assetStartTime).toFixed(1)
        : null;

      const rasterizeDuration = this.currentSwitch.assetDocParsedTime
        ? (now - this.currentSwitch.assetDocParsedTime).toFixed(1)
        : null;

      if (rasterizeDuration) {
        console.log(
          `%c🖼️ [Floorplan Asset] High-res canvas rendered in ${rasterizeDuration}ms (Total asset time: ${totalAssetDuration}ms) ${extraInfo}`,
          'color: #0284c7; font-weight: bold; font-size: 11px;'
        );
      } else if (totalAssetDuration) {
        console.log(
          `%c🖼️ [Floorplan Asset] Asset ready in ${totalAssetDuration}ms (${this.currentSwitch.assetType || 'image'}) ${extraInfo}`,
          'color: #0284c7; font-weight: bold; font-size: 11px;'
        );
      }

      this.finishSwitch(floorplanId);
    }
  }

  /**
   * Record background ETag revalidation outcome.
   */
  recordBackgroundRevalidation(floorplanId, { status, duration, updated }) {
    console.log(
      `%c🔄 [Floorplan Data] Background revalidation: ${status} in ${duration.toFixed(1)}ms${updated ? ' (cache refreshed)' : ''}`,
      'color: #64748b; font-size: 10px;'
    );
  }

  /**
   * Conclude the switch timing session and display summary table.
   */
  finishSwitch(floorplanId) {
    if (!this.currentSwitch || this.currentSwitch.floorplanId !== String(floorplanId) || this.currentSwitch.completed) {
      return;
    }

    const now = performance.now();
    this.currentSwitch.completed = true;
    const totalTime = (now - this.currentSwitch.startTime).toFixed(1);
    this.currentSwitch.totalTime = totalTime;

    const dataDuration = this.currentSwitch.dataEndTime
      ? `${(this.currentSwitch.dataEndTime - this.currentSwitch.dataStartTime).toFixed(1)} ms`
      : '0.0 ms';

    const assetTotalDuration = (this.currentSwitch.assetStartTime && this.currentSwitch.assetRenderEndTime)
      ? `${(this.currentSwitch.assetRenderEndTime - this.currentSwitch.assetStartTime).toFixed(1)} ms`
      : 'N/A';

    const pdfParseDuration = (this.currentSwitch.assetStartTime && this.currentSwitch.assetDocParsedTime)
      ? `${(this.currentSwitch.assetDocParsedTime - this.currentSwitch.assetStartTime).toFixed(1)} ms`
      : null;

    const pdfRasterDuration = (this.currentSwitch.assetDocParsedTime && this.currentSwitch.assetRenderEndTime)
      ? `${(this.currentSwitch.assetRenderEndTime - this.currentSwitch.assetDocParsedTime).toFixed(1)} ms`
      : null;

    trackPageLoadTime('floorplan_map', Number(totalTime), {
      floorplan_id: String(floorplanId),
      asset_type: this.currentSwitch.assetType || 'unknown',
      source: this.currentSwitch.source,
    });

    console.log(
      `%c✅ [Floorplan Switch Complete] "${this.currentSwitch.floorplanName}" (ID: ${floorplanId}) loaded in ${totalTime}ms ` +
      `[Data: ${dataDuration} (${this.currentSwitch.dataSource || 'cache'}) | Render: ${assetTotalDuration} (${this.currentSwitch.assetType || 'asset'})]`,
      'color: #047857; font-weight: bold; font-size: 12px; background: #ecfdf5; padding: 3px 8px; border-radius: 4px; border: 1px solid #6ee7b7;'
    );

    if (console.table) {
      const summary = {
        'Target Floorplan': `${this.currentSwitch.floorplanName} (ID: ${floorplanId})`,
        'Trigger / Source': this.currentSwitch.source,
        'Data Load Time': dataDuration,
        'Data Source': this.currentSwitch.dataSource || 'N/A',
        'Entity Counts': this.currentSwitch.dataDetails
          ? `${this.currentSwitch.dataDetails.rooms} rooms, ${this.currentSwitch.dataDetails.equipment} equip, ${this.currentSwitch.dataDetails.tickets} tickets`
          : 'N/A',
        'Asset Type': (this.currentSwitch.assetType || 'unknown').toUpperCase(),
        ...(pdfParseDuration ? { 'PDF Parse Time': pdfParseDuration } : {}),
        ...(pdfRasterDuration ? { 'PDF Canvas Raster Time': pdfRasterDuration } : {}),
        'Asset Render Time': assetTotalDuration,
        'TOTAL Switch Time': `${totalTime} ms`
      };
      console.table(summary);
    }
  }
}

export const floorplanLogger = new FloorplanTimingLogger();
