"""
KiranaMitra - api/reorder.py - Vercel Python serverless function  ->  POST /api/reorder

Takes the product list, validates it, and returns the sorted reorder list.
Same rules as public/stock.js:
    LOW   : quantity <= threshold
    ORDER : max(threshold * 2 - quantity, 1)
    SORT  : biggest shortage (threshold - quantity) first, then name, then SKU

No dependencies, no secrets, nothing is stored on the server.
Only this one file lives in api/ because Vercel turns every .py file there into a function.
"""
import json
from http.server import BaseHTTPRequestHandler

MAX_NUMBER = 1_000_000
MAX_BODY_BYTES = 1_000_000
MAX_PRODUCTS = 5000


def _is_count(value):
    # bool is a subclass of int in Python, so exclude it explicitly
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_NUMBER


def validate_products(products):
    """Return an error string, or None if the list is valid."""
    if not isinstance(products, list):
        return "'products' must be a list."
    if len(products) > MAX_PRODUCTS:
        return "Too many products (max %d)." % MAX_PRODUCTS
    for i, p in enumerate(products):
        where = "Product #%d" % (i + 1)
        if not isinstance(p, dict):
            return "%s must be an object." % where
        if not isinstance(p.get("name"), str) or not p["name"].strip():
            return "%s: name is required." % where
        if not isinstance(p.get("sku"), str) or not p["sku"].strip():
            return "%s: sku is required." % where
        if not _is_count(p.get("quantity")):
            return "%s: quantity must be a whole number, 0 or more." % where
        if not _is_count(p.get("threshold")):
            return "%s: threshold must be a whole number, 0 or more." % where
    return None


def build_reorder_list(products):
    """Low-stock products, most urgent first, with a suggested order quantity."""
    items = []
    for p in products:
        if p["quantity"] <= p["threshold"]:
            items.append({
                "sku": p["sku"].strip().upper(),
                "name": p["name"].strip(),
                "quantity": p["quantity"],
                "threshold": p["threshold"],
                "order_qty": max(p["threshold"] * 2 - p["quantity"], 1),
            })
    items.sort(key=lambda i: (-(i["threshold"] - i["quantity"]), i["name"].lower(), i["sku"]))
    return items


def process_request(body_bytes):
    """Shared by the Vercel handler and dev_server.py. Returns (status_code, dict)."""
    if len(body_bytes) > MAX_BODY_BYTES:
        return 413, {"error": "Request too large."}
    try:
        data = json.loads(body_bytes.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return 400, {"error": "Body must be valid JSON."}
    if not isinstance(data, dict):
        return 400, {"error": "Body must be a JSON object like {\"products\": [...]}."}
    error = validate_products(data.get("products"))
    if error:
        return 400, {"error": error}
    items = build_reorder_list(data["products"])
    return 200, {"count": len(items), "items": items}


class handler(BaseHTTPRequestHandler):
    """Vercel looks for a class named `handler` in this file."""

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"status": "ok", "usage": "POST {\"products\": [...]} to get the reorder list"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, {"error": "Bad Content-Length."})
        if length > MAX_BODY_BYTES:
            return self._send(413, {"error": "Request too large."})
        status, payload = process_request(self.rfile.read(length))
        self._send(status, payload)
