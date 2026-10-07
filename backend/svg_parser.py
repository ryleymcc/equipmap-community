import re
from bs4 import BeautifulSoup

def parse_svg_for_rooms(svg_content: str):
    """
    Parses SVG content to find <text> elements.
    Returns a list of dicts with room info: [{'name': '...', 'x_coordinate': ..., 'y_coordinate': ...}]
    """
    rooms = []
    soup = BeautifulSoup(svg_content, "xml") # requires lxml
    text_elements = soup.find_all("text")

    for text_el in text_elements:
        text_content = text_el.get_text(strip=True)
        if not text_content:
            continue

        # Try to extract x and y coordinates
        x_str = text_el.get("x")
        y_str = text_el.get("y")

        # Sometimes AutoCAD SVG exports have transform="matrix(...)"
        # Or coordinates in tspan
        if not x_str or not y_str:
            tspan = text_el.find("tspan")
            if tspan:
                x_str = tspan.get("x") or x_str
                y_str = tspan.get("y") or y_str

        # If still no basic x/y, try to parse transform attribute
        if not x_str or not y_str:
            transform = text_el.get("transform")
            if transform:
                # e.g., matrix(1 0 0 1 123.45 67.89)
                match = re.search(r"matrix\(([\d\.\-\s]+)\)", transform)
                if match:
                    parts = match.group(1).split()
                    if len(parts) == 6:
                        x_str = parts[4]
                        y_str = parts[5]

        # Cleanup and convert to float
        try:
            x_val = float(x_str.replace("px", "")) if x_str else 0.0
            y_val = float(y_str.replace("px", "")) if y_str else 0.0
        except (ValueError, AttributeError):
            x_val = 0.0
            y_val = 0.0

        rooms.append({
            "name": text_content,
            "x_coordinate": x_val,
            "y_coordinate": y_val
        })

    return rooms
