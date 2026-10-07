import { Link } from 'react-router-dom';
import './Promo.css';

export default function Promo() {
  return (
    <div className="promo-container">
      {/* Navbar */}
      <nav className="promo-nav">
        <Link to="/promo" className="promo-logo">FACILITY FLOW</Link>
        <div className="promo-nav-links">
          <Link to="/login" className="btn-secondary">Login</Link>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="promo-hero">
        <h1>Visual Facility Management</h1>
        <p>
          Stop digging through spreadsheets. See exactly where your assets are,
          track maintenance in real-time, and empower your team in the field.
        </p>
        <div className="promo-cta-group">
          <a href="#" className="btn-primary">Try Live Demo</a>
          <Link to="/login" className="btn-secondary">Get Started</Link>
        </div>

        <div className="screenshot-desktop">
          <div className="glow-overlay"></div>
        </div>
      </header>

      {/* Feature 1: Visual Ticketing (Image) */}
      <section className="feature-showcase">
        <div className="feature-info">
          <h2>Stop Searching, Start Fixing</h2>
          <p>
            When an issue is reported, it appears exactly where it is on the floorplan.
            Technicians know exactly which room and which corner to head to before they even leave the office.
          </p>
          <ul className="operator-content list-none p-0">
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Visual Map-Based Ticketing
            </li>
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Direct Asset Context
            </li>
          </ul>
        </div>
        <div className="feature-media">
          <div className="media-placeholder-image">
            <div className="glow-overlay"></div>
            <p className="mt-md text-sm">Showing: Highlighted Map Pin + Ticket Details</p>
          </div>
        </div>
      </section>

      {/* Feature 2: Search & Share (Video) */}
      <section className="feature-showcase bg-promo-alt">
        <div className="feature-info">
          <h2>Universal Search & Share</h2>
          <p>
            Locate any valve, room, or ticket in seconds. Generate a direct link that highlights
            the exact equipment on the map and share it instantly with contractors.
          </p>
          <ul className="operator-content list-none p-0">
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Instant Multi-Asset Search
            </li>
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Highlighted Deep-Links
            </li>
          </ul>
        </div>
        <div className="feature-media">
          <div className="media-placeholder-video">
            <p className="text-sm">Search rooms, equipment, and tickets from your own facility map.</p>
          </div>
        </div>

      </section>

      {/* Feature 3: Offline Support (Mobile Image) */}
      <section className="feature-showcase">
        <div className="feature-info">
          <h2>Built for the Basement</h2>
          <p>
            Maintenance doesn't stop for dead zones. Access your floorplans and asset data
            even in network dead zones like basements or mechanical rooms.
          </p>
          <ul className="operator-content list-none p-0">
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Reliable Offline View-Only
            </li>
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Mobile-Optimized Layout
            </li>
          </ul>
        </div>
        <div className="feature-media flex-center">
          <div className="screenshot-mobile">
            <div className="glow-overlay"></div>
            <p className="mt-auto text-sm pb-2xl">Showing: Offline status indicator + Mobile Map</p>
          </div>
        </div>
      </section>

      {/* Feature 4: Rapid Audits (Video) */}
      <section className="feature-showcase bg-promo-alt">
        <div className="feature-info">
          <h2>Streamlined Facility Audits</h2>
          <p>
            Log entire corridors of rooms and equipment in record time. Our rapid-placement
            tools handle auto-naming and sequential tagging effortlessly.
          </p>
          <ul className="operator-content list-none p-0">
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Sequential Asset Placement
            </li>
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Auto-Incrementing Room Names
            </li>
          </ul>
        </div>
        <div className="feature-media">
          <div className="media-placeholder-video">
            <div className="glow-overlay"></div>
            <p className="mt-md text-sm">Demo: Adding 5 rooms in 10 seconds</p>
          </div>
        </div>
      </section>

      {/* Feature 5: Accountability (Image) */}
      <section className="feature-showcase">
        <div className="feature-info">
          <h2>Complete Accountability</h2>
          <p>
            Every change is tracked. See exactly who updated an asset, what was changed,
            and when, ensuring compliance and peace of mind.
          </p>
          <ul className="operator-content list-none p-0">
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Full Audit History
            </li>
            <li className="items-center gap-sm mb-sm">
              <span className="text-accent-promo">✓</span> Multi-User Permissions
            </li>
          </ul>
        </div>
        <div className="feature-media">
          <div className="media-placeholder-image">
            <div className="glow-overlay"></div>
            <p className="mt-md text-sm">Showing: Audit Log Timeline</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="promo-footer">
        <p>&copy; 2026 Facility Flow Management System. All rights reserved.</p>
      </footer>
    </div>
  );
}
