import re
from bs4 import BeautifulSoup
from fastapi import HTTPException

def parse_svg_for_rooms(svg_content: str | bytes):
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


def validate_svg(source):
    from lxml import etree
    try:
        tree = etree.parse(source, etree.XMLParser(resolve_entities=False, no_network=True))
        if tree.docinfo.doctype or tree.xpath('//processing-instruction()') or etree.QName(tree.getroot()).localname != 'svg':
            raise ValueError('Invalid SVG')
        for node in tree.iter():
            if not isinstance(node.tag, str):
                continue
            if etree.QName(node).localname.lower() in ('script', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'set', 'animatetransform', 'animatemotion'):
                raise ValueError('Active content')
            for key, value in node.attrib.items():
                name = etree.QName(key).localname.lower()
                if name.startswith('on') or (name == 'href' and not value.startswith(('#', 'data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,'))):
                    raise ValueError('External or active content')
                if any(not reference.strip(' \t\r\n\'\"').startswith('#') for reference in re.findall(r'url\((.*?)\)', value, re.I)):
                    raise ValueError('External content')
            if etree.QName(node).localname == 'style':
                css = node.text or ''
                if '\\' in css or re.search(r'@import', css, re.I) or any(not reference.strip(' \t\r\n\'\"').startswith('#') for reference in re.findall(r'url\((.*?)\)', css, re.I)):
                    raise ValueError('External stylesheet content')
    except Exception:
        raise HTTPException(400, 'Choose a standalone SVG without scripts, embedded HTML or external resources.')
