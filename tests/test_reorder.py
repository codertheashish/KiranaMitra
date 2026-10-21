"""Run:  python -m unittest discover -s tests -v"""
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.reorder import build_reorder_list, handler, process_request, validate_products  # noqa: E402

PRODUCTS = [
    {"name": "Atta", "sku": "atta-5kg", "quantity": 3, "threshold": 10},
    {"name": "Salt", "sku": "SALT", "quantity": 0, "threshold": 8},
    {"name": "Oil", "sku": "OIL", "quantity": 6, "threshold": 6},
    {"name": "Maggi", "sku": "MAGGI", "quantity": 40, "threshold": 15},
]


class ReorderLogic(unittest.TestCase):
    def test_sorted_by_biggest_shortage(self):
        items = build_reorder_list(PRODUCTS)
        self.assertEqual([i["sku"] for i in items], ["SALT", "ATTA-5KG", "OIL"])

    def test_order_quantities(self):
        items = build_reorder_list(PRODUCTS)
        self.assertEqual([i["order_qty"] for i in items], [16, 17, 6])

    def test_order_qty_minimum_one(self):
        items = build_reorder_list([{"name": "Gum", "sku": "GUM", "quantity": 0, "threshold": 0}])
        self.assertEqual(items[0]["order_qty"], 1)

    def test_nothing_low(self):
        self.assertEqual(build_reorder_list([PRODUCTS[3]]), [])


class Validation(unittest.TestCase):
    def test_valid(self):
        self.assertIsNone(validate_products(PRODUCTS))

    def test_rejects_bad_shapes(self):
        bad = [
            "nope",
            [1],
            [{"name": "", "sku": "A", "quantity": 1, "threshold": 1}],
            [{"name": "A", "sku": "", "quantity": 1, "threshold": 1}],
            [{"name": "A", "sku": "A", "quantity": -1, "threshold": 1}],
            [{"name": "A", "sku": "A", "quantity": 1.5, "threshold": 1}],
            [{"name": "A", "sku": "A", "quantity": True, "threshold": 1}],
            [{"name": "A", "sku": "A", "quantity": "5", "threshold": 1}],
            [{"name": "A", "sku": "A", "quantity": 1}],
        ]
        for value in bad:
            self.assertIsNotNone(validate_products(value), msg=repr(value))

    def test_process_request_errors(self):
        self.assertEqual(process_request(b"not json")[0], 400)
        self.assertEqual(process_request(b"[]")[0], 400)
        self.assertEqual(process_request(b"{}")[0], 400)
        self.assertEqual(process_request(b'{"products": "x"}')[0], 400)


class HttpHandler(unittest.TestCase):
    """Starts the real `handler` class on a random local port."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, body):
        req = urllib.request.Request(
            "http://127.0.0.1:%d/api/reorder" % self.port,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_post_ok(self):
        status, data = self.post(json.dumps({"products": PRODUCTS}).encode())
        self.assertEqual(status, 200)
        self.assertEqual(data["count"], 3)
        self.assertEqual([i["sku"] for i in data["items"]], ["SALT", "ATTA-5KG", "OIL"])

    def test_post_bad_json(self):
        status, data = self.post(b"{broken")
        self.assertEqual(status, 400)
        self.assertIn("error", data)

    def test_get_health(self):
        with urllib.request.urlopen("http://127.0.0.1:%d/api/reorder" % self.port) as resp:
            self.assertEqual(json.loads(resp.read())["status"], "ok")


if __name__ == "__main__":
    unittest.main()
