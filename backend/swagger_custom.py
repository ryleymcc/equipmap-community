"""
Custom Swagger / OpenAPI UI & Security Documentation generator for EquipMap.
Provides:
1. Enhanced OpenAPI schema with explicit authentication badges, role requirements, and security matrix.
2. Custom responsive Swagger UI with live Auth/Public filtering, metric stats, and security badges.
3. Structured endpoint summary for security auditing and dashboards.
"""

from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.openapi.utils import get_openapi
import json

def determine_endpoint_role(path: str, method: str, summary: str, is_auth: bool) -> str:
    """Determine the role or permission required for an endpoint."""
    if not is_auth:
        return "Public (No Auth)"

    path_lower = path.lower()
    summary_lower = summary.lower()

    if "revoke-sessions" in path_lower or "undo" in path_lower:
        return "Admin Only"
    if path_lower.startswith("/api/users") and method in ["POST", "PUT", "DELETE"]:
        return "Admin Only"
    if "bulk" in path_lower and ("delete" in path_lower or "assign" in path_lower or "close" in path_lower):
        return "Admin / Triage / Assign"
    if "triage" in summary_lower:
        return "Admin / Triage"
    if "pm-schedules" in path_lower:
        return "Admin / PM Manager"
    if path_lower.startswith("/api/sites") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/floorplans") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/rooms") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/equipment") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/trades") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/tasks") and method in ["POST", "PUT", "DELETE"]:
        return "Admin / Editor"
    if path_lower.startswith("/api/work-orders") and method == "POST" and "public" not in path_lower:
        return "Admin / Editor / WO Creator"

    return "Active User (Bearer Token)"


def generate_custom_openapi(app: FastAPI, app_version: str) -> Dict[str, Any]:
    """Generate OpenAPI schema with clear [🔒 AUTH] and [🌐 PUBLIC] badges and security metadata."""
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="EquipMap API Documentation",
        version=app_version,
        description=(
            "Interactive OpenAPI & Swagger documentation for EquipMap API.\n\n"
            "### 🛡️ Authentication & Authorization Status\n"
            "- **🔒 Authenticated Endpoints**: Require a valid JWT Bearer token in `Authorization: Bearer <token>`.\n"
            "- **🌐 Public Endpoints**: Unauthenticated endpoints accessible without login (e.g. login, public work order submissions, public push notification keys, health checks).\n"
        ),
        routes=app.routes,
    )

    auth_count = 0
    public_count = 0
    matrix_rows = []

    # Paths enrichment
    for path, methods in openapi_schema.get("paths", {}).items():
        for method, operation in methods.items():
            if method.lower() not in ["get", "post", "put", "delete", "patch", "options", "head"]:
                continue

            security = operation.get("security")
            is_auth = bool(security and len(security) > 0)
            original_summary = operation.get("summary", "")
            role_req = determine_endpoint_role(path, method.upper(), original_summary, is_auth)
            tags = operation.get("tags", ["default"])
            tag_name = tags[0] if tags else "default"

            if is_auth:
                auth_count += 1
                badge = "[🔒 AUTH]"
                operation["x-auth-status"] = "authenticated"
                operation["x-required-role"] = role_req
                auth_desc = (
                    f"**Security**: 🔒 **Authentication Required** (`{role_req}`)\n\n"
                    f"Requires a valid JWT Bearer access token in the `Authorization: Bearer <token>` header.\n\n---\n\n"
                )
            else:
                public_count += 1
                badge = "[🌐 PUBLIC]"
                operation["x-auth-status"] = "public"
                operation["x-required-role"] = "Public (No Auth)"
                auth_desc = (
                    f"**Security**: 🌐 **Public Endpoint** (No authentication required)\n\n---\n\n"
                )

            # Update summary if not already tagged
            if not original_summary.startswith("[🔒 AUTH]") and not original_summary.startswith("[🌐 PUBLIC]"):
                operation["summary"] = f"{badge} {original_summary}" if original_summary else f"{badge} {method.upper()} {path}"

            # Prepend security info to description
            existing_desc = operation.get("description", "")
            operation["description"] = auth_desc + (existing_desc if existing_desc else "")

            matrix_rows.append((method.upper(), path, "🔒 AUTH" if is_auth else "🌐 PUBLIC", role_req, tag_name))

    # Add Security Matrix summary to top level description
    total_endpoints = auth_count + public_count
    openapi_schema["info"]["description"] += (
        f"\n\n**API Summary Stats:**\n"
        f"- **Total Endpoints:** `{total_endpoints}`\n"
        f"- **🔒 Authenticated:** `{auth_count}`\n"
        f"- **🌐 Public / Unauthenticated:** `{public_count}`\n\n"
    )

    app.openapi_schema = openapi_schema
    return app.openapi_schema


def get_endpoints_summary_data(app: FastAPI, app_version: str) -> Dict[str, Any]:
    """Produce a structured JSON summary of all endpoints and their authentication/role status."""
    openapi = generate_custom_openapi(app, app_version)

    auth_list = []
    public_list = []
    all_list = []
    tags_set = set()

    for path, methods in openapi.get("paths", {}).items():
        for method, operation in methods.items():
            if method.lower() not in ["get", "post", "put", "delete", "patch"]:
                continue

            is_auth = operation.get("x-auth-status") == "authenticated" or bool(operation.get("security"))
            role_req = operation.get("x-required-role") or determine_endpoint_role(path, method.upper(), operation.get("summary", ""), is_auth)
            tags = operation.get("tags", ["General"])
            for t in tags:
                tags_set.add(t)

            raw_summary = operation.get("summary", "")
            cleaned_summary = raw_summary.replace("[🔒 AUTH]", "").replace("[🌐 PUBLIC]", "").strip()

            endpoint_info = {
                "method": method.upper(),
                "path": path,
                "summary": cleaned_summary,
                "is_authenticated": is_auth,
                "auth_status": "authenticated" if is_auth else "public",
                "required_role": role_req,
                "tags": tags,
                "operation_id": operation.get("operationId", "")
            }

            all_list.append(endpoint_info)
            if is_auth:
                auth_list.append(endpoint_info)
            else:
                public_list.append(endpoint_info)

    # Sort endpoints by tag and path
    all_list.sort(key=lambda x: (x["tags"][0] if x["tags"] else "", x["path"], x["method"]))
    auth_list.sort(key=lambda x: (x["tags"][0] if x["tags"] else "", x["path"], x["method"]))
    public_list.sort(key=lambda x: (x["tags"][0] if x["tags"] else "", x["path"], x["method"]))

    return {
        "title": "EquipMap API Endpoints Summary",
        "version": app_version,
        "stats": {
            "total_endpoints": len(all_list),
            "authenticated_count": len(auth_list),
            "public_count": len(public_list),
            "total_tags": len(tags_set),
            "tags": sorted(list(tags_set))
        },
        "endpoints": all_list,
        "authenticated_endpoints": auth_list,
        "public_endpoints": public_list
    }


def render_custom_swagger_ui_html(
    openapi_url: str = "/openapi.json",
    title: str = "EquipMap API Docs & Auth Explorer",
    app_version: str = "1.0.0"
) -> str:
    """Generate high-aesthetic, interactive Swagger UI HTML page with live Auth filter toolbar and matrix."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2338bdf8'><path d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/></svg>">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg-primary: #0b0f19;
      --bg-secondary: #111827;
      --bg-card: rgba(17, 24, 39, 0.85);
      --bg-card-border: rgba(255, 255, 255, 0.08);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #38bdf8;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --accent-purple: #a855f7;
      --border-color: #1e293b;
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }}

    /* Top Navigation Bar */
    .top-navbar {{
      background: rgba(11, 15, 25, 0.95);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 1000;
      padding: 1rem 2rem;
    }}

    .nav-container {{
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }}

    .nav-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }}

    .brand-section {{
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }}

    .brand-logo {{
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #0284c7, #38bdf8);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);
    }}

    .brand-logo svg {{
      width: 22px;
      height: 22px;
      fill: #ffffff;
    }}

    .brand-title {{
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #ffffff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}

    .brand-version {{
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }}

    .nav-actions {{
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }}

    .action-btn {{
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.9rem;
      border-radius: 8px;
      font-size: 0.825rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
    }}

    .action-btn:hover {{
      background: #1e293b;
      border-color: #334155;
      transform: translateY(-1px);
    }}

    .action-btn.primary {{
      background: linear-gradient(135deg, #0284c7, #2563eb);
      border-color: #38bdf8;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
    }}

    .action-btn.primary:hover {{
      box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
    }}

    /* Stat Cards */
    .stats-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
    }}

    .stat-card {{
      background: var(--bg-card);
      border: 1px solid var(--bg-card-border);
      border-radius: 12px;
      padding: 0.85rem 1.15rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: all 0.2s ease;
    }}

    .stat-card:hover {{
      border-color: rgba(56, 189, 248, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
    }}

    .stat-card.active {{
      border-color: var(--accent-blue);
      background: rgba(56, 189, 248, 0.08);
    }}

    .stat-info {{
      display: flex;
      flex-direction: column;
    }}

    .stat-label {{
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }}

    .stat-value {{
      font-size: 1.5rem;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-primary);
      margin-top: 0.1rem;
    }}

    .stat-card.auth .stat-value {{ color: var(--accent-emerald); }}
    .stat-card.public .stat-value {{ color: var(--accent-amber); }}
    .stat-card.total .stat-value {{ color: var(--accent-blue); }}

    .stat-icon {{
      font-size: 1.5rem;
      opacity: 0.8;
    }}

    /* Interactive Filter Bar */
    .filter-bar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      background: rgba(17, 24, 39, 0.6);
      padding: 0.6rem 0.85rem;
      border-radius: 10px;
      border: 1px solid var(--border-color);
    }}

    .filter-pills {{
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }}

    .filter-pill {{
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary);
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }}

    .filter-pill:hover {{
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.05);
    }}

    .filter-pill.active {{
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.4);
      color: var(--accent-blue);
    }}

    .filter-pill.active.auth {{
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.4);
      color: var(--accent-emerald);
    }}

    .filter-pill.active.public {{
      background: rgba(245, 158, 11, 0.15);
      border-color: rgba(245, 158, 11, 0.4);
      color: var(--accent-amber);
    }}

    .search-input-wrapper {{
      position: relative;
      min-width: 260px;
      flex-grow: 1;
      max-width: 400px;
    }}

    .search-input {{
      width: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.45rem 0.85rem 0.45rem 2.2rem;
      color: var(--text-primary);
      font-size: 0.825rem;
      outline: none;
      transition: border-color 0.2s ease;
    }}

    .search-input:focus {{
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }}

    .search-icon {{
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }}

    /* Swagger UI Container */
    #swagger-ui {{
      max-width: 1400px;
      margin: 1.5rem auto 4rem auto;
      padding: 0 2rem;
    }}

    /* Custom Swagger UI Dark Styles */
    .swagger-ui {{
      color: var(--text-primary);
      font-family: inherit;
    }}

    .swagger-ui .info {{
      margin: 1.5rem 0 2rem 0;
    }}

    .swagger-ui .info .title {{
      color: var(--text-primary);
      font-size: 2rem;
      font-weight: 800;
    }}

    .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table {{
      color: var(--text-secondary);
      font-size: 0.95rem;
      line-height: 1.6;
    }}

    .swagger-ui .scheme-container {{
      background: var(--bg-secondary);
      box-shadow: none;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.25rem;
      margin: 1.5rem 0;
    }}

    .swagger-ui .opblock-tag {{
      color: var(--text-primary);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 0;
      font-weight: 700;
    }}

    .swagger-ui .opblock-tag small {{
      color: var(--text-muted);
    }}

    .swagger-ui .opblock {{
      background: rgba(17, 24, 39, 0.75) !important;
      border: 1px solid var(--border-color) !important;
      border-radius: 10px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
      margin: 0 0 1rem 0 !important;
      transition: all 0.2s ease;
    }}

    .swagger-ui .opblock:hover {{
      border-color: rgba(255, 255, 255, 0.15) !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3) !important;
    }}

    .swagger-ui .opblock .opblock-summary {{
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
    }}

    .swagger-ui .opblock .opblock-summary-path {{
      color: var(--text-primary) !important;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      font-weight: 600;
    }}

    .swagger-ui .opblock .opblock-summary-description {{
      color: var(--text-secondary) !important;
      font-size: 0.85rem;
    }}

    .swagger-ui .opblock-body {{
      background: #0d1322 !important;
    }}

    .swagger-ui .opblock-body pre {{
      background: #080c14 !important;
      color: #e2e8f0 !important;
    }}

    .swagger-ui table thead tr th {{
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
    }}

    .swagger-ui table tbody tr td {{
      color: var(--text-primary);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }}

    .swagger-ui .parameter__name {{
      color: var(--accent-blue);
      font-family: 'JetBrains Mono', monospace;
    }}

    .swagger-ui .parameter__type {{
      color: var(--text-muted);
    }}

    .swagger-ui input[type=text], .swagger-ui textarea, .swagger-ui select {{
      background: var(--bg-secondary) !important;
      border: 1px solid var(--border-color) !important;
      color: var(--text-primary) !important;
      border-radius: 6px !important;
    }}

    .swagger-ui .btn {{
      border-radius: 6px !important;
      font-weight: 600;
    }}

    .swagger-ui .btn.authorize {{
      background: rgba(16, 185, 129, 0.15) !important;
      border-color: var(--accent-emerald) !important;
      color: var(--accent-emerald) !important;
    }}

    .swagger-ui .btn.authorize svg {{
      fill: var(--accent-emerald) !important;
    }}

    /* Injected Badges on Swagger Operation Blocks */
    .eq-auth-badge {{
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.725rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      margin-left: 0.65rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
      flex-shrink: 0;
    }}

    .eq-auth-badge.auth {{
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
    }}

    .eq-auth-badge.public {{
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.35);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.15);
    }}

    /* Modal for Endpoint Security Matrix */
    .modal-overlay {{
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      z-index: 2000;
      padding: 2rem;
      overflow-y: auto;
    }}

    .modal-overlay.open {{
      display: flex;
      align-items: center;
      justify-content: center;
    }}

    .modal-content {{
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      max-width: 1100px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }}

    .modal-header {{
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}

    .modal-title {{
      font-size: 1.25rem;
      font-weight: 700;
    }}

    .modal-close {{
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
    }}

    .modal-close:hover {{
      color: var(--text-primary);
    }}

    .modal-body {{
      padding: 1.5rem;
      overflow-y: auto;
    }}

    .matrix-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }}

    .matrix-table th {{
      text-align: left;
      padding: 0.75rem 1rem;
      background: #0f172a;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
      font-weight: 600;
      position: sticky;
      top: 0;
    }}

    .matrix-table td {{
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      color: var(--text-primary);
    }}

    .matrix-table tr:hover td {{
      background: rgba(255, 255, 255, 0.02);
    }}

    .method-badge {{
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 800;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
    }}

    .method-get {{ background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }}
    .method-post {{ background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); }}
    .method-put {{ background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); }}
    .method-delete {{ background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.4); }}

    .endpoint-path {{
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
    }}

    .role-badge {{
      background: rgba(148, 163, 184, 0.1);
      color: #cbd5e1;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
    }}
  </style>
</head>
<body>
  <!-- Top Navigation & Stats Bar -->
  <header class="top-navbar">
    <div class="nav-container">
      <div class="nav-header">
        <div class="brand-section">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          <div>
            <span class="brand-title">EquipMap API Portal</span>
            <span class="brand-version">v{app_version}</span>
          </div>
        </div>
        <div class="nav-actions">
          <button class="action-btn" onclick="openMatrixModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
            Security Matrix
          </button>
          <a class="action-btn" href="/api/endpoints-summary" target="_blank">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            JSON Summary
          </a>
          <a class="action-btn" href="{openapi_url}" target="_blank">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            OpenAPI Spec
          </a>
        </div>
      </div>

      <!-- Stat Cards -->
      <div class="stats-grid">
        <div class="stat-card total active" onclick="setAuthFilter('all')">
          <div class="stat-info">
            <span class="stat-label">Total Endpoints</span>
            <span class="stat-value" id="stat-total">--</span>
          </div>
          <span class="stat-icon">📊</span>
        </div>
        <div class="stat-card auth" onclick="setAuthFilter('auth')">
          <div class="stat-info">
            <span class="stat-label">Authenticated</span>
            <span class="stat-value" id="stat-auth">--</span>
          </div>
          <span class="stat-icon">🔒</span>
        </div>
        <div class="stat-card public" onclick="setAuthFilter('public')">
          <div class="stat-info">
            <span class="stat-label">Public / No Auth</span>
            <span class="stat-value" id="stat-public">--</span>
          </div>
          <span class="stat-icon">🌐</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="filter-bar">
        <div class="filter-pills">
          <button class="filter-pill active" data-filter="all" onclick="setAuthFilter('all')">All Endpoints</button>
          <button class="filter-pill auth" data-filter="auth" onclick="setAuthFilter('auth')">🔒 Authenticated Only</button>
          <button class="filter-pill public" data-filter="public" onclick="setAuthFilter('public')">🌐 Public Only</button>
        </div>
        <div class="search-input-wrapper">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="endpoint-search" class="search-input" placeholder="Search paths, summaries, tags..." oninput="handleSearch(this.value)">
        </div>
      </div>
    </div>
  </header>

  <!-- Swagger UI Mount Point -->
  <div id="swagger-ui"></div>

  <!-- Endpoint Security Matrix Modal -->
  <div id="matrix-modal" class="modal-overlay" onclick="handleModalOverlayClick(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="modal-title">🛡️ API Endpoint Security & Authentication Matrix</h3>
        <button class="modal-close" onclick="closeMatrixModal()">&times;</button>
      </div>
      <div class="modal-body">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint Path</th>
              <th>Auth Status</th>
              <th>Required Role / Permission</th>
              <th>Module / Tag</th>
            </tr>
          </thead>
          <tbody id="matrix-table-body">
            <tr><td colspan="5" style="text-align:center; padding: 2rem;">Loading API Matrix...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Swagger UI Scripts -->
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    let currentAuthFilter = 'all';
    let currentSearchTerm = '';
    let apiData = null;

    window.ui = SwaggerUIBundle({{
      url: '{openapi_url}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset
      ],
      layout: 'BaseLayout',
      defaultModelsExpandDepth: -1,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      onComplete: () => {{
        fetchSummaryData();
        attachAuthBadges();
        setupSwaggerMutationObserver();
      }}
    }});

    async function fetchSummaryData() {{
      try {{
        const res = await fetch('/api/endpoints-summary');
        apiData = await res.json();

        document.getElementById('stat-total').textContent = apiData.stats.total_endpoints;
        document.getElementById('stat-auth').textContent = apiData.stats.authenticated_count;
        document.getElementById('stat-public').textContent = apiData.stats.public_count;

        renderMatrixTable(apiData.endpoints);
      }} catch (err) {{
        console.error('Failed to load summary data:', err);
      }}
    }}

    function renderMatrixTable(endpoints) {{
      const tbody = document.getElementById('matrix-table-body');
      if (!endpoints || !endpoints.length) return;

      tbody.innerHTML = endpoints.map(ep => {{
        const mClass = 'method-' + ep.method.toLowerCase();
        const authBadge = ep.is_authenticated
          ? '<span class="eq-auth-badge auth">🔒 Authenticated</span>'
          : '<span class="eq-auth-badge public">🌐 Public</span>';

        return `
          <tr>
            <td><span class="method-badge ${{mClass}}">${{ep.method}}</span></td>
            <td><span class="endpoint-path">${{ep.path}}</span></td>
            <td>${{authBadge}}</td>
            <td><span class="role-badge">${{ep.required_role}}</span></td>
            <td>${{ep.tags[0] || 'general'}}</td>
          </tr>
        `;
      }}).join('');
    }}

    function attachAuthBadges() {{
      const opblocks = document.querySelectorAll('.swagger-ui .opblock');
      opblocks.forEach(block => {{
        if (block.dataset.authProcessed) return;

        const pathEl = block.querySelector('.opblock-summary-path a, .opblock-summary-path span');
        const descEl = block.querySelector('.opblock-summary-description');
        const summaryText = (descEl ? descEl.textContent : '') + (pathEl ? pathEl.textContent : '');

        // Determine auth status from summary prefix or lock icon
        const isAuth = summaryText.includes('[🔒 AUTH]') || block.querySelector('.authorization__btn');
        block.dataset.isAuth = isAuth ? 'auth' : 'public';

        // Add badge element if not already attached
        if (pathEl && !block.querySelector('.eq-auth-badge')) {{
          const badge = document.createElement('span');
          badge.className = 'eq-auth-badge ' + (isAuth ? 'auth' : 'public');
          badge.textContent = isAuth ? '🔒 Authenticated' : '🌐 Public';
          pathEl.parentNode.appendChild(badge);
        }}

        block.dataset.authProcessed = 'true';
      }});

      applyFilters();
    }}

    function setupSwaggerMutationObserver() {{
      const target = document.getElementById('swagger-ui');
      if (!target) return;
      const observer = new MutationObserver(() => {{
        attachAuthBadges();
      }});
      observer.observe(target, {{ childList: true, subtree: true }});
    }}

    function setAuthFilter(filter) {{
      currentAuthFilter = filter;

      // Update stat cards
      document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
      if (filter === 'all') document.querySelector('.stat-card.total')?.classList.add('active');
      if (filter === 'auth') document.querySelector('.stat-card.auth')?.classList.add('active');
      if (filter === 'public') document.querySelector('.stat-card.public')?.classList.add('active');

      // Update pills
      document.querySelectorAll('.filter-pill').forEach(pill => {{
        if (pill.dataset.filter === filter) {{
          pill.classList.add('active');
        }} else {{
          pill.classList.remove('active');
        }}
      }});

      applyFilters();
    }}

    function handleSearch(term) {{
      currentSearchTerm = term.toLowerCase().trim();
      applyFilters();
    }}

    function applyFilters() {{
      const opblocks = document.querySelectorAll('.swagger-ui .opblock');
      const tagSections = document.querySelectorAll('.swagger-ui .opblock-tag-section');

      opblocks.forEach(block => {{
        const isAuth = block.dataset.isAuth === 'auth';
        let matchesAuth = true;

        if (currentAuthFilter === 'auth') matchesAuth = isAuth;
        if (currentAuthFilter === 'public') matchesAuth = !isAuth;

        let matchesSearch = true;
        if (currentSearchTerm) {{
          const text = block.textContent.toLowerCase();
          matchesSearch = text.includes(currentSearchTerm);
        }}

        if (matchesAuth && matchesSearch) {{
          block.style.display = '';
        }} else {{
          block.style.display = 'none';
        }}
      }});

      // Hide tag sections if all child operations are hidden
      tagSections.forEach(section => {{
        const visibleOps = section.querySelectorAll('.opblock:not([style*="display: none"])');
        if (visibleOps.length === 0) {{
          section.style.display = 'none';
        }} else {{
          section.style.display = '';
        }}
      }});
    }}

    function openMatrixModal() {{
      document.getElementById('matrix-modal').classList.add('open');
    }}

    function closeMatrixModal() {{
      document.getElementById('matrix-modal').classList.remove('open');
    }}

    function handleModalOverlayClick(e) {{
      if (e.target.id === 'matrix-modal') {{
        closeMatrixModal();
      }}
    }}

    document.addEventListener('keydown', (e) => {{
      if (e.key === 'Escape') closeMatrixModal();
    }});
  </script>
</body>
</html>"""
