import  { useState, useEffect, useRef, useCallback } from 'react';
import { Document as PdfDocument, Page as PdfPage, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  Building, Wrench, HelpCircle, AlertTriangle, CheckCircle2,
  MapPin, ChevronRight, ChevronLeft, Send,
  Copy, Check, RefreshCw, X, Loader2,
  ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2
} from 'lucide-react';
import {
  getSites, getFloorplans, getRooms, getEquipment,
  getAllRooms, getAllEquipment,
  createPublicWorkOrder, getErrorMessage, BASE_URL
} from '../api';
import EntitySearchSelector from '../components/EntitySearchSelector';
import './PublicRequestPortal.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PRIORITIES = [
  { id: 'low', label: 'Low', desc: 'Routine repair / aesthetic', class: 'low' },
  { id: 'medium', label: 'Medium', desc: 'Standard maintenance', class: 'medium' },
  { id: 'high', label: 'High', desc: 'Disrupting operations', class: 'high' },
  { id: 'urgent', label: 'Critical', desc: 'Safety hazard / emergency', class: 'urgent' },
];

const getFloorplanUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
};

export default function PublicRequestPortal() {
  // Wizard Step: 1 = All-in-one Request Form, 2 = Review & Submit, 3 = Success
  const [currentStep, setCurrentStep] = useState(1);

  // Form State - Issue
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');

  // Location State
  const [locationType, setLocationType] = useState('room'); // 'room' | 'equipment' | 'pin' | 'none'
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [floorplans, setFloorplans] = useState([]);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState('');
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);

  // Multi-selection for rooms & equipment
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [availableEquipment, setAvailableEquipment] = useState([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState([]);

  // Custom pin coordinates on floorplan
  const [pinCoord, setPinCoord] = useState(null);
  const [locationDetails, setLocationDetails] = useState('');

  // Contact Info State with LocalStorage Persistence ("Remember Me")
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return localStorage.getItem('public_request_remember_me') === 'true';
    } catch {
      return false;
    }
  });

  const [requesterName, setRequesterName] = useState(() => {
    try {
      if (localStorage.getItem('public_request_remember_me') === 'true') {
        const saved = JSON.parse(localStorage.getItem('public_request_contact_info') || '{}');
        return saved.requesterName || saved.name || '';
      }
    } catch {
      // ignore
    }
    return '';
  });

  const [requesterEmail, setRequesterEmail] = useState(() => {
    try {
      if (localStorage.getItem('public_request_remember_me') === 'true') {
        const saved = JSON.parse(localStorage.getItem('public_request_contact_info') || '{}');
        return saved.requesterEmail || saved.email || '';
      }
    } catch {
      // ignore
    }
    return '';
  });

  const [requesterPhone, setRequesterPhone] = useState(() => {
    try {
      if (localStorage.getItem('public_request_remember_me') === 'true') {
        const saved = JSON.parse(localStorage.getItem('public_request_contact_info') || '{}');
        return saved.requesterPhone || saved.phone || '';
      }
    } catch {
      // ignore
    }
    return '';
  });

  const [department, setDepartment] = useState(() => {
    try {
      if (localStorage.getItem('public_request_remember_me') === 'true') {
        const saved = JSON.parse(localStorage.getItem('public_request_contact_info') || '{}');
        return saved.department || '';
      }
    } catch {
      // ignore
    }
    return '';
  });

  // Sync Contact Info to localStorage when "Remember Me" is active
  useEffect(() => {
    try {
      if (rememberMe) {
        localStorage.setItem('public_request_remember_me', 'true');
        localStorage.setItem('public_request_contact_info', JSON.stringify({
          requesterName,
          requesterEmail,
          requesterPhone,
          department,
        }));
      } else {
        localStorage.setItem('public_request_remember_me', 'false');
        localStorage.removeItem('public_request_contact_info');
      }
    } catch (err) {
      console.warn('Failed to access localStorage for contact info:', err);
    }
  }, [rememberMe, requesterName, requesterEmail, requesterPhone, department]);

  // Submission & Validation State
  const [validationError, setValidationError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const [copiedNumber, setCopiedNumber] = useState(false);

  // Load Sites on Mount
  useEffect(() => {
    getSites()
      .then(res => {
        setSites(res.data || []);
      })
      .catch(err => console.error("Error loading sites:", err));
  }, []);

  // Load Floorplans when Site changes
  useEffect(() => {
    if (!selectedSiteId) return;
    getFloorplans(selectedSiteId)
      .then(res => {
        setFloorplans(res.data || []);
      })
      .catch(err => console.error("Error loading floorplans:", err));
  }, [selectedSiteId]);

  const [previousSiteId, setPreviousSiteId] = useState(selectedSiteId);
  const [previousFloorplanId, setPreviousFloorplanId] = useState(selectedFloorplanId);
  if (previousSiteId !== selectedSiteId) {
    setPreviousSiteId(selectedSiteId);
    setSelectedFloorplanId('');
    setPinCoord(null);
    setFloorplans([]);
  }
  if (previousFloorplanId !== selectedFloorplanId) {
    setPreviousFloorplanId(selectedFloorplanId);
    setPinCoord(null);
  }

  // Load Rooms & Equipment: floorplan-specific, site-wide, or campus-wide
  useEffect(() => {
    if (selectedFloorplanId) {
      // Specific floorplan
      getRooms(selectedFloorplanId)
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getEquipment(selectedFloorplanId)
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    } else if (selectedSiteId) {
      // Specific site across all floorplans
      const siteNum = parseInt(selectedSiteId, 10);
      getAllRooms()
        .then(res => setAvailableRooms((res.data || []).filter(r => r.site_id === siteNum)))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment((res.data || []).filter(e => e.site_id === siteNum)))
        .catch(() => setAvailableEquipment([]));
    } else {
      // Campus-wide (all sites & floors)
      getAllRooms()
        .then(res => setAvailableRooms(res.data || []))
        .catch(() => setAvailableRooms([]));

      getAllEquipment()
        .then(res => setAvailableEquipment(res.data || []))
        .catch(() => setAvailableEquipment([]));
    }
  }, [selectedFloorplanId, selectedSiteId]);

  const mapContainerRef = useRef(null);
  const transformComponentRef = useRef(null);
  const lastStateRef = useRef({
    scale: 0.35,
    focalX: 1000,
    focalY: 700,
    lastWrapW: 0,
    lastWrapH: 0,
  });

  const updateTransformState = (ref) => {
    if (!ref?.state) return;
    const { scale, positionX, positionY } = ref.state;

    const wrapper = ref.instance?.wrapperComponent || mapContainerRef.current?.querySelector('.pin-picker-transform-wrapper') || mapContainerRef.current;

    if (wrapper && scale > 0) {
      const wrapRect = wrapper.getBoundingClientRect();
      const wrapW = wrapRect.width;
      const wrapH = wrapRect.height;

      if (wrapW > 0 && wrapH > 0) {
        // Only update focal coordinates if wrapper dimensions are stable (not during screen transition)
        const isSizeStable = lastStateRef.current.lastWrapW === 0 || Math.abs(wrapW - lastStateRef.current.lastWrapW) < 5;

        if (isSizeStable) {
          const focalX = (wrapW / 2 - positionX) / scale;
          const focalY = (wrapH / 2 - positionY) / scale;

          lastStateRef.current.focalX = focalX;
          lastStateRef.current.focalY = focalY;
        }

        lastStateRef.current.scale = scale;
        lastStateRef.current.lastWrapW = wrapW;
        lastStateRef.current.lastWrapH = wrapH;
      }
    }

    if (pinPickerRef.current) {
      pinPickerRef.current.style.setProperty('--current-zoom', scale);
    }
  };

  const fitFloorplanToView = useCallback((customRef) => {
    const controls = customRef?.setTransform ? customRef : transformComponentRef.current;
    if (!controls) return;

    const wrapper = controls.instance?.wrapperComponent || mapContainerRef.current?.querySelector('.pin-picker-transform-wrapper') || mapContainerRef.current;
    const box = pinPickerRef.current;
    if (!wrapper || !box) return;

    const wrapRect = wrapper.getBoundingClientRect();
    const el = box.querySelector('img, canvas') || box;
    const imgH = el.offsetHeight || 1400;
    const imgW = 2000;

    const wrapW = wrapRect.width || 736;
    const wrapH = wrapRect.height || 480;

    if (wrapW > 0 && wrapH > 0 && imgW > 0 && imgH > 0) {
      const padding = 16;
      const availableW = Math.max(100, wrapW - padding * 2);
      const availableH = Math.max(100, wrapH - padding * 2);

      const scaleX = availableW / imgW;
      const scaleY = availableH / imgH;
      const fitScale = Math.max(0.05, Math.min(scaleX, scaleY));

      const posX = (wrapW - imgW * fitScale) / 2;
      const posY = (wrapH - imgH * fitScale) / 2;

      if (typeof controls.setTransform === 'function') {
        controls.setTransform(posX, posY, fitScale, 0);
        lastStateRef.current = {
          scale: fitScale,
          focalX: imgW / 2,
          focalY: imgH / 2,
          lastWrapW: wrapW,
          lastWrapH: wrapH,
        };
      }
      if (pinPickerRef.current) {
        pinPickerRef.current.style.setProperty('--current-zoom', fitScale);
      }
    }
  }, []);

  // Preserve map view center whenever entering or exiting fullscreen
  useEffect(() => {
    const restorePosition = () => {
      if (!transformComponentRef.current) return;
      const wrapper = transformComponentRef.current.instance?.wrapperComponent || mapContainerRef.current?.querySelector('.pin-picker-transform-wrapper') || mapContainerRef.current;
      if (!wrapper) return;

      const wrapRect = wrapper.getBoundingClientRect();
      const { scale = 0.35, focalX = 1000, focalY = 700 } = lastStateRef.current;
      const currentScale = transformComponentRef.current.state?.scale || scale || 0.35;

      const wrapW = wrapRect.width;
      const wrapH = wrapRect.height;

      if (wrapW > 0 && wrapH > 0) {
        const newPosX = (wrapW / 2) - (focalX * currentScale);
        const newPosY = (wrapH / 2) - (focalY * currentScale);

        if (typeof transformComponentRef.current.setTransform === 'function') {
          transformComponentRef.current.setTransform(newPosX, newPosY, currentScale, 0);
          lastStateRef.current.lastWrapW = wrapW;
          lastStateRef.current.lastWrapH = wrapH;
        }
        if (pinPickerRef.current) {
          pinPickerRef.current.style.setProperty('--current-zoom', currentScale);
        }
      }
    };

    const t1 = setTimeout(restorePosition, 30);
    const t2 = setTimeout(restorePosition, 100);
    const t3 = setTimeout(restorePosition, 250);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isMapFullscreen]);

  // Close fullscreen on Escape key, listen to browser native fullscreen change, and lock body scroll
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      setIsMapFullscreen(isNativeFs);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isMapFullscreen) {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
        setIsMapFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);

    if (isMapFullscreen) {
      document.body.classList.add('map-fullscreen-active');
      document.body.style.overflow = 'hidden';
    } else {
      document.body.classList.remove('map-fullscreen-active');
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('map-fullscreen-active');
      document.body.style.overflow = '';
    };
  }, [isMapFullscreen]);

  const toggleFullscreen = async () => {
    const isCurrentlyFs = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      isMapFullscreen
    );

    if (!isCurrentlyFs) {
      setIsMapFullscreen(true);
      try {
        const el = mapContainerRef.current;
        if (el?.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el?.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el?.msRequestFullscreen) {
          await el.msRequestFullscreen();
        }
      } catch (err) {
        console.warn("Native fullscreen request rejected/unavailable, falling back to CSS viewport fullscreen", err);
      }
    } else {
      setIsMapFullscreen(false);
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            await document.webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn("Exit fullscreen failed", err);
      }
    }
  };

  // Pin click on floorplan preview image / canvas with pan-vs-click drag detection
  const pinPickerRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const descriptionRef = useRef(null);

  const handleDescriptionChange = (e) => {
    setDescription(e.target.value);
    if (descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    if (descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
    }
  }, [description]);

  const handlePinPickerPointerDown = (e) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePinPickerClick = (e) => {
    const dx = Math.abs(e.clientX - dragStartRef.current.x);
    const dy = Math.abs(e.clientY - dragStartRef.current.y);
    if (dx > 6 || dy > 6) return; // ignore panning drag

    const targetBox = pinPickerRef.current || e.currentTarget;
    if (!targetBox) return;
    const rect = targetBox.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    // EquipMap coordinate standard: maps onto a 2000px wide floorplan canvas
    const xCoord = Math.round((relX / rect.width) * 2000);
    const yCoord = Math.round((relY / rect.width) * 2000);
    const pctX = (relX / rect.width) * 100;
    const pctY = (relY / rect.height) * 100;

    setPinCoord({
      x: xCoord,
      y: yCoord,
      pctX,
      pctY
    });
  };

  const toggleRoomSelection = (roomId) => {
    setSelectedRoomIds(prev =>
      prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
    );
  };

  const toggleEquipmentSelection = (equipId) => {
    setSelectedEquipmentIds(prev =>
      prev.includes(equipId) ? prev.filter(id => id !== equipId) : [...prev, equipId]
    );
  };

  const handleGoToReview = (e) => {
    if (e) e.preventDefault();
    setValidationError(null);

    if (!title.trim()) {
      setValidationError('Please enter a summary title for the maintenance issue.');
      const el = document.getElementById('issue-title-input');
      if (el) el.focus();
      return;
    }

    if (locationType === 'pin') {
      if (!selectedSiteId) {
        setValidationError('Please select a Building / Site to drop a location pin.');
        const el = document.getElementById('site-selector');
        if (el) el.focus();
        return;
      }
      if (!selectedFloorplanId) {
        setValidationError('Please select a specific Floor / Level blueprint to drop a pin.');
        const el = document.getElementById('floorplan-selector');
        if (el) el.focus();
        return;
      }
      if (!pinCoord) {
        setValidationError('Please click on the floorplan blueprint above to place a location pin.');
        return;
      }
    }

    if (!requesterName.trim()) {
      setValidationError('Please enter your name in the contact section so staff can follow up.');
      const el = document.getElementById('requester-name-input');
      if (el) el.focus();
      return;
    }

    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevStep = () => {
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    const getClientDeviceDetails = () => {
      try {
        const screenWidth = window.screen?.width || window.innerWidth;
        const screenHeight = window.screen?.height || window.innerHeight;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
        const deviceType = isMobile ? (window.innerWidth >= 768 ? 'Tablet' : 'Mobile') : 'Desktop';
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const platform = navigator.userAgentData?.platform || navigator.platform || '';

        const parts = [];
        if (deviceType) parts.push(deviceType);
        if (screenWidth && screenHeight) parts.push(`${screenWidth}x${screenHeight}`);
        if (platform) parts.push(platform);
        if (tz) parts.push(tz);

        return parts.join(' • ') || undefined;
      } catch {
        return undefined;
      }
    };

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      location_type: locationType,
      site_id: selectedSiteId ? parseInt(selectedSiteId, 10) : undefined,
      floorplan_id: selectedFloorplanId ? parseInt(selectedFloorplanId, 10) : undefined,
      room_ids: locationType === 'room' ? selectedRoomIds : [],
      equipment_ids: locationType === 'equipment' ? selectedEquipmentIds : [],
      x_coordinate: locationType === 'pin' && pinCoord ? pinCoord.x : undefined,
      y_coordinate: locationType === 'pin' && pinCoord ? pinCoord.y : undefined,
      location_details: [locationDetails.trim(), department ? `Dept: ${department.trim()}` : '']
        .filter(Boolean)
        .join(' | ') || undefined,
      requester_name: requesterName.trim() || 'Anonymous',
      requester_email: requesterEmail.trim() || undefined,
      requester_phone: requesterPhone.trim() || undefined,
      device_details: getClientDeviceDetails(),
    };

    try {
      const res = await createPublicWorkOrder(payload);
      setSubmittedOrder(res.data);
      setCurrentStep(3); // Success step
    } catch (err) {
      console.error('Error submitting maintenance request:', err);
      setSubmitError(getErrorMessage(err, 'Failed to submit maintenance request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyNumber = () => {
    if (!submittedOrder?.order_number) return;
    navigator.clipboard.writeText(submittedOrder.order_number);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  const handleResetForm = () => {
    setTitle('');
    setPriority('medium');
    setDescription('');
    setLocationType('room');
    setSelectedSiteId('');
    setSelectedFloorplanId('');
    setSelectedRoomIds([]);
    setSelectedEquipmentIds([]);
    setPinCoord(null);
    setLocationDetails('');
    if (!rememberMe) {
      setRequesterName('');
      setRequesterEmail('');
      setRequesterPhone('');
      setDepartment('');
    }
    setSubmittedOrder(null);
    setValidationError(null);
    setSubmitError(null);
    setCurrentStep(1);
  };

  const currentFloorplanObj = floorplans.find(f => String(f.id) === selectedFloorplanId);

  return (
    <div className="public-portal-container">
      {/* Header */}
      <header className="public-portal-header">
        <div className="portal-brand">
          <div className="portal-logo-box">
            <Building size={22} color="#fff" />
          </div>
          <div>
            <h1 className="portal-title-text">Maintenance Request Form</h1>
          </div>
        </div>
      </header>

      {/* Main Wizard Card */}
      <div className="portal-card">
        {/* Step Progress Bar */}
        {currentStep <= 2 && !submittedOrder && (
          <div className="wizard-progress-bar">
            <div className={`wizard-step-tab ${currentStep === 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
              <div className="step-num-bubble">{currentStep > 1 ? <Check size={12} /> : 1}</div>
              <span>Request Details</span>
            </div>
            <div className={`wizard-step-tab ${currentStep === 2 ? 'active' : ''}`}>
              <div className="step-num-bubble">2</div>
              <span>Review & Submit</span>
            </div>
          </div>
        )}

        {/* Wizard Body */}
        <div className="portal-card-body">
          {/* STEP 1: Combined All-in-One Request Form */}
          {currentStep === 1 && !submittedOrder && (
            <div>
              {validationError && (
                <div className="alert-box-danger p-md mb-md">
                  <div className="items-center gap-xs font-semibold">
                    <AlertTriangle size={16} />
                    <span>Missing Required Information</span>
                  </div>
                  <div className="text-xs mt-xs">{validationError}</div>
                </div>
              )}

              {/* 1. Issue Details */}
              <div className="form-section-block">

                {/* Title Input */}
                <div className="input-group">
                  <label htmlFor="issue-title-input">Issue Summary / Title <span className="text-danger">*</span></label>
                  <input
                    id="issue-title-input"
                    type="text"
                    className="input-field"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Sink in Room 204 leaking, AC blowing warm air"
                    required
                  />
                </div>

                {/* Urgency / Priority */}
                <div className="input-group">
                  <label>Urgency Level</label>
                  <div className="priority-pills-row">
                    {PRIORITIES.map(p => (
                      <div
                        key={p.id}
                        className={`priority-pill-btn ${p.class} ${priority === p.id ? 'selected' : ''}`}
                        onClick={() => setPriority(p.id)}
                        role="radio"
                        aria-checked={priority === p.id}
                        tabIndex={0}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPriority(p.id); } }}
                      >
                        <span className="priority-title">{p.label}</span>
                        <span className="priority-desc">{p.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Detailed Description */}
                <div className="input-group">
                  <label htmlFor="request-description">Details & Additional Information (Optional)</label>
                  <textarea id="request-description"
                    ref={descriptionRef}
                    className="input-field auto-grow-textarea"
                    rows={3}
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder="Provide any helpful context, error codes, noises, or specific instructions for the technician..."
                  />
                </div>
              </div>

              {/* 2. Location Details */}
              <div className="form-section-block">
                <div className="section-title-badge-row">
                  <div>
                    <h2 className="section-heading-text">Where is the issue located?</h2>
                    <p className="section-subheading-text">Help technicians locate the problem quickly.</p>
                  </div>
                </div>

                {/* Location Type Selector */}
                <div className="location-type-grid">
                  <div
                    className={`location-type-card ${locationType === 'room' ? 'selected' : ''}`}
                    onClick={() => setLocationType('room')}
                    role="radio"
                    aria-checked={locationType === 'room'}
                    tabIndex={0}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLocationType('room'); } }}
                  >
                    <div className="loc-type-icon-box">
                      <Building size={18} />
                    </div>
                    <div>
                      <div className="loc-type-title">Specific Room(s)</div>
                      <div className="loc-type-subtitle">Choose from facility room directory</div>
                    </div>
                  </div>

                  <div
                    className={`location-type-card ${locationType === 'equipment' ? 'selected' : ''}`}
                    onClick={() => setLocationType('equipment')}
                    role="radio"
                    aria-checked={locationType === 'equipment'}
                    tabIndex={0}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLocationType('equipment'); } }}
                  >
                    <div className="loc-type-icon-box">
                      <Wrench size={18} />
                    </div>
                    <div>
                      <div className="loc-type-title">Specific Equipment</div>
                      <div className="loc-type-subtitle">Pick from catalog (AHU, pump, electrical, etc.)</div>
                    </div>
                  </div>

                  <div
                    className={`location-type-card ${locationType === 'pin' ? 'selected' : ''}`}
                    onClick={() => setLocationType('pin')}
                    role="radio"
                    aria-checked={locationType === 'pin'}
                    tabIndex={0}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLocationType('pin'); } }}
                  >
                    <div className="loc-type-icon-box">
                      <MapPin size={18} />
                    </div>
                    <div>
                      <div className="loc-type-title">Drop a Pin on Floorplan</div>
                      <div className="loc-type-subtitle">Point to exact spot on the map</div>
                    </div>
                  </div>

                  <div
                    className={`location-type-card ${locationType === 'none' ? 'selected' : ''}`}
                    onClick={() => setLocationType('none')}
                    role="radio"
                    aria-checked={locationType === 'none'}
                    tabIndex={0}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLocationType('none'); } }}
                  >
                    <div className="loc-type-icon-box">
                      <HelpCircle size={18} />
                    </div>
                    <div>
                      <div className="loc-type-title">Unsure / Campus-wide</div>
                      <div className="loc-type-subtitle">No specific location</div>
                    </div>
                  </div>
                </div>

                {/* Site & Floorplan Selectors (if not 'none') */}
                {locationType !== 'none' && (
                  <div className="grid-responsive-layout mb-md">
                    <div className="input-group">
                      <label htmlFor="site-selector">
                        Building / Site {locationType === 'pin' && <span className="text-danger">*</span>}
                      </label>
                      <select
                        id="site-selector"
                        className="input-field"
                        value={selectedSiteId}
                        onChange={e => setSelectedSiteId(e.target.value)}
                      >
                        {locationType === 'pin' ? (
                          <option value="" disabled>-- Select a Building --</option>
                        ) : (
                          <option value="">Campus-wide / Any Building</option>
                        )}
                        {sites.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="input-group">
                      <label htmlFor="floorplan-selector">
                        Floor / Level {locationType === 'pin' && <span className="text-danger">*</span>}
                      </label>
                      <select
                        id="floorplan-selector"
                        className="input-field"
                        value={selectedFloorplanId}
                        onChange={e => setSelectedFloorplanId(e.target.value)}
                        disabled={!selectedSiteId || (locationType === 'pin' && floorplans.length === 0)}
                      >
                        {locationType === 'pin' ? (
                          <option value="" disabled>
                            {!selectedSiteId
                              ? "-- Select Building First --"
                              : (floorplans.length > 0 ? "-- Select a Floor / Level --" : "-- No Floorplans Found --")}
                          </option>
                        ) : (
                          <option value="">All Floors</option>
                        )}
                        {floorplans.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Specific Room Selection with Search Bar */}
                {locationType === 'room' && (
                  <div className="mb-md">
                    <EntitySearchSelector
                      entityType="room"
                      items={availableRooms}
                      selectedIds={selectedRoomIds}
                      onToggle={toggleRoomSelection}
                      onClearAll={() => setSelectedRoomIds([])}
                      placeholder={
                        selectedFloorplanId
                          ? "Search rooms on this floor..."
                          : selectedSiteId
                            ? "Search rooms in this building..."
                            : "Search all rooms across all buildings & floors..."
                      }
                    />
                  </div>
                )}

                {/* Specific Equipment Selection with Search Bar */}
                {locationType === 'equipment' && (
                  <div className="mb-md">
                    <EntitySearchSelector
                      entityType="equipment"
                      items={availableEquipment}
                      selectedIds={selectedEquipmentIds}
                      onToggle={toggleEquipmentSelection}
                      onClearAll={() => setSelectedEquipmentIds([])}
                      placeholder={
                        selectedFloorplanId
                          ? "Search equipment on this floor..."
                          : selectedSiteId
                            ? "Search equipment in this building..."
                            : "Search all equipment across all buildings & floors..."
                      }
                    />
                  </div>
                )}

                {/* Interactive Map Pin Picker */}
                {locationType === 'pin' && (
                  <div className="mb-md">
                    {!selectedSiteId ? (
                      <div className="alert-box-info p-md text-sm">
                        Please select a <strong>Building</strong> above to view available floor blueprints.
                      </div>
                    ) : !selectedFloorplanId ? (
                      <div className="alert-box-info p-md text-sm">
                        Please select a <strong>Floor / Level</strong> above to view the blueprint and drop your location pin.
                      </div>
                    ) : !currentFloorplanObj?.file_path ? (
                      <div className="alert-box-info p-md text-sm">
                        No map blueprint found for this floor. You can provide location notes below.
                      </div>
                    ) : (
                      <div
                        ref={mapContainerRef}
                        className={`pin-picker-interactive-container ${isMapFullscreen ? 'fullscreen' : ''}`}
                      >
                        <TransformWrapper
                          ref={transformComponentRef}
                          initialScale={0.35}
                          minScale={0.05}
                          maxScale={30}
                          centerOnInit={true}
                          smooth={false}
                          limitToBounds={false}
                          disablePadding={true}
                          autoAlignment={{ disabled: true }}
                          zoomAnimation={{ disabled: true }}
                          velocityAnimation={{ disabled: true }}
                          alignmentAnimation={{ disabled: true }}
                          panning={{ velocityDisabled: true }}
                          wheel={{ step: 0.05 }}
                          doubleClick={{ disabled: true }}
                          onInit={(ref) => {
                            updateTransformState(ref);
                            setTimeout(() => fitFloorplanToView(ref), 60);
                          }}
                          onTransform={updateTransformState}
                          onTransformed={updateTransformState}
                          onZoom={updateTransformState}
                        >
                          {({ zoomIn, zoomOut }) => (
                            <>
                              <div className="pin-picker-toolbar">
                                <button
                                  type="button"
                                  onClick={() => zoomIn(0.1)}
                                  className="btn-picker-tool"
                                  title="Zoom In (Smooth)"
                                >
                                  <ZoomIn size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => zoomOut(0.1)}
                                  className="btn-picker-tool"
                                  title="Zoom Out (Smooth)"
                                >
                                  <ZoomOut size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => fitFloorplanToView()}
                                  className="btn-picker-tool"
                                  title="Fit & Reset Map View"
                                >
                                  <RotateCcw size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={toggleFullscreen}
                                  className={`btn-picker-tool ${isMapFullscreen ? 'active' : ''}`}
                                  title={isMapFullscreen ? "Exit Fullscreen (Esc)" : "Full Screen Map"}
                                >
                                  {isMapFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                </button>
                              </div>

                              <div className="pin-picker-hint">
                                Click blueprint to drop pin • Scroll / use buttons to zoom{isMapFullscreen ? ' • Esc to exit' : ''}
                              </div>

                              <TransformComponent
                                wrapperClass="pin-picker-transform-wrapper"
                                contentClass="pin-picker-transform-content"
                              >
                                <div
                                  ref={pinPickerRef}
                                  className="pin-picker-content-box"
                                  onPointerDown={handlePinPickerPointerDown}
                                  onClick={handlePinPickerClick}
                                >
                                  {currentFloorplanObj.file_type === 'pdf' ? (
                                    <div className="pin-picker-pdf-layer">
                                      <PdfDocument
                                        file={getFloorplanUrl(currentFloorplanObj.file_path)}
                                        loading={
                                          <div className="flex-center p-xl">
                                            <Loader2 size={24} className="spinning text-primary" />
                                          </div>
                                        }
                                        error={
                                          <div className="alert-box-danger p-md text-xs">
                                            <AlertTriangle size={20} />
                                            <span>Failed to load PDF floorplan map</span>
                                          </div>
                                        }
                                      >
                                        <PdfPage
                                          pageNumber={1}
                                          width={2000}
                                          devicePixelRatio={5}
                                          renderTextLayer={false}
                                          renderAnnotationLayer={false}
                                          onRenderSuccess={() => setTimeout(() => fitFloorplanToView(), 60)}
                                        />
                                      </PdfDocument>
                                    </div>
                                  ) : (
                                    <img
                                      src={getFloorplanUrl(currentFloorplanObj.file_path)}
                                      alt={currentFloorplanObj.name}
                                      className="pin-picker-img"
                                      draggable={false}
                                      onLoad={() => setTimeout(() => fitFloorplanToView(), 60)}
                                    />
                                  )}

                                  {pinCoord && (
                                    <div
                                      className="pin-target-marker"
                                      style={{
                                        left: `${pinCoord.pctX ?? ((pinCoord.x / 2000) * 100)}%`,
                                        top: `${pinCoord.pctY ?? ((pinCoord.y / 2000) * 100)}%`,
                                      }}
                                    >
                                      <div className="pin-target-marker-inner">
                                        <MapPin size={14} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TransformComponent>
                            </>
                          )}
                        </TransformWrapper>
                      </div>
                    )}

                    {pinCoord && (
                      <div className="pin-coord-badge">
                        <MapPin size={14} className="text-warning" />
                        <span>Pin dropped at ({pinCoord.x}, {pinCoord.y})</span>
                        <button
                          type="button"
                          onClick={() => setPinCoord(null)}
                          className="btn btn-ghost btn-icon-xs text-muted"
                          title="Clear Pin"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Additional Location Notes */}
                <div className="input-group">
                  <label htmlFor="request-location-notes">Specific Location Notes / Room Description (Optional)</label>
                  <input id="request-location-notes"
                    type="text"
                    className="input-field"
                    value={locationDetails}
                    onChange={e => setLocationDetails(e.target.value)}
                    placeholder="e.g. North corridor near water fountain, 2nd stall from left, Desk 14"
                  />
                </div>
              </div>

              {/* 3. Contact Information */}
              <div className="form-section-block">
                <div className="section-title-badge-row">

                  <div>
                    <h2 className="section-heading-text">Your Contact Information</h2>
                    <p className="section-subheading-text">So our maintenance team can reach you with updates or questions.</p>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="requester-name-input">Your Full Name <span className="text-danger">*</span></label>
                  <input
                    id="requester-name-input"
                    type="text"
                    className="input-field"
                    value={requesterName}
                    onChange={e => setRequesterName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    required
                  />
                </div>

                <div className="grid-responsive-layout">
                  <div className="input-group">
                    <label htmlFor="requester-email">Email Address</label>
                    <input id="requester-email"
                      type="email"
                      className="input-field"
                      value={requesterEmail}
                      onChange={e => setRequesterEmail(e.target.value)}
                      placeholder="e.g. jane@organization.com"
                    />
                  </div>

                  <div className="input-group">
                    <label htmlFor="requester-phone">Phone Number (Optional)</label>
                    <input id="requester-phone"
                      type="tel"
                      className="input-field"
                      value={requesterPhone}
                      onChange={e => setRequesterPhone(e.target.value)}
                      placeholder="e.g. (204) 555-0123"
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="requester-department">Department / Unit (Optional)</label>
                  <input id="requester-department"
                    type="text"
                    className="input-field"
                    value={department}
                    onChange={e => setDepartment(e.target.value)}
                    placeholder="e.g. Radiology, Pediatrics, Admin, Facilities"
                  />
                </div>

                {/* Remember Me Checkbox */}
                <div className="remember-contact-row">
                  <label className="remember-contact-label" htmlFor="remember-contact-checkbox">
                    <input
                      id="remember-contact-checkbox"
                      type="checkbox"
                      className="remember-contact-checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                    />
                    <span className="remember-contact-text">
                      Remember my contact information on this device
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Review & Submit */}
          {currentStep === 2 && !submittedOrder && (
            <div>
              <div className="wizard-step-header">
                <h2 className="wizard-step-title">Review & Submit Request</h2>
                <p className="wizard-step-desc">Please verify the details before submitting to the facilities queue.</p>
              </div>

              {submitError && (
                <div className="alert-box-danger p-md mb-md">
                  <div className="items-center gap-xs font-semibold">
                    <AlertTriangle size={16} />
                    <span>Submission Error</span>
                  </div>
                  <div className="text-xs mt-xs">{submitError}</div>
                </div>
              )}

              <div className="review-summary-card">
                <div className="review-item-row">
                  <span className="review-label">Summary</span>
                  <span className="review-value text-primary">{title}</span>
                </div>

                <div className="review-item-row">
                  <span className="review-label">Urgency</span>
                  <span className={`review-value uppercase font-bold text-${priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'info'}`}>
                    {priority}
                  </span>
                </div>

                {description && (
                  <div className="review-item-row">
                    <span className="review-label">Description</span>
                    <span className="review-value">{description}</span>
                  </div>
                )}

                <div className="review-item-row">
                  <span className="review-label">Location Type</span>
                  <span className="review-value capitalize">{locationType}</span>
                </div>

                {selectedSiteId && (
                  <div className="review-item-row">
                    <span className="review-label">Building / Site</span>
                    <span className="review-value">{sites.find(s => String(s.id) === String(selectedSiteId))?.name || 'Selected Site'}</span>
                  </div>
                )}

                {selectedFloorplanId && (
                  <div className="review-item-row">
                    <span className="review-label">Floor / Level</span>
                    <span className="review-value">{floorplans.find(f => String(f.id) === String(selectedFloorplanId))?.name || 'Selected Floor'}</span>
                  </div>
                )}

                {selectedRoomIds.length > 0 && (
                  <div className="review-item-row">
                    <span className="review-label">Selected Rooms</span>
                    <span className="review-value">
                      {availableRooms.filter(r => selectedRoomIds.includes(r.id)).map(r => r.name).join(', ') || `${selectedRoomIds.length} rooms`}
                    </span>
                  </div>
                )}

                {selectedEquipmentIds.length > 0 && (
                  <div className="review-item-row">
                    <span className="review-label">Selected Equipment</span>
                    <span className="review-value">
                      {availableEquipment.filter(e => selectedEquipmentIds.includes(e.id)).map(e => e.name).join(', ') || `${selectedEquipmentIds.length} items`}
                    </span>
                  </div>
                )}

                {pinCoord && (
                  <div className="review-item-row">
                    <span className="review-label">Map Pin</span>
                    <span className="review-value">Position ({pinCoord.x}, {pinCoord.y})</span>
                  </div>
                )}

                {locationDetails && (
                  <div className="review-item-row">
                    <span className="review-label">Location Notes</span>
                    <span className="review-value">{locationDetails}</span>
                  </div>
                )}

                <div className="review-item-row">
                  <span className="review-label">Requester</span>
                  <span className="review-value">{requesterName} {requesterEmail ? `(${requesterEmail})` : ''}</span>
                </div>

                {requesterPhone && (
                  <div className="review-item-row">
                    <span className="review-label">Phone</span>
                    <span className="review-value">{requesterPhone}</span>
                  </div>
                )}

                {department && (
                  <div className="review-item-row">
                    <span className="review-label">Department</span>
                    <span className="review-value">{department}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Success Confirmation */}
          {submittedOrder && (
            <div className="success-confirmation-box">
              <div className="success-icon-bubble">
                <CheckCircle2 size={36} />
              </div>

              <div>
                <h2 className="text-xl font-bold text-primary m-0 mb-xs">
                  Request Submitted Successfully!
                </h2>
                <p className="text-sm text-muted m-0">
                  Your maintenance request has been assigned a tracking number and queued for dispatch.
                </p>
              </div>

              <div className="order-badge-pill">
                <span>{submittedOrder.order_number}</span>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="btn btn-ghost btn-icon-xs text-muted"
                  title="Copy Tracking Number"
                >
                  {copiedNumber ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                </button>
              </div>

              <div className="text-xs text-muted max-w-400">
                Facility operations will review and dispatch your request. Your contact details help the team follow up if needed.
              </div>

              <div className="flex-row gap-sm mt-md flex-wrap justify-center">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="btn btn-primary btn-sm gap-xs"
                >
                  <RefreshCw size={14} />
                  <span>Submit Another Request</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Navigation */}
        {!submittedOrder && (
          <div className="portal-card-footer">
            {currentStep === 2 ? (
              <button
                type="button"
                onClick={handlePrevStep}
                className="btn btn-secondary gap-xs"
              >
                <ChevronLeft size={16} />
                <span>Back to Edit</span>
              </button>
            ) : (
              <div />
            )}

            {currentStep === 1 ? (
              <button
                type="button"
                onClick={handleGoToReview}
                className="btn btn-primary gap-xs"
              >
                <span>Review & Submit</span>
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="btn btn-primary btn-success-gradient gap-xs"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="spinning" />
                    <span>Submitting Request...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Submit Maintenance Request</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
