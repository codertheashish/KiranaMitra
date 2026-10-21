# KiranaMitra

**Smart Stock. Simple Dukaan.**

Hackathon prototype for **Problem 1: The Kirana Problem** - a small shop never runs out of stock by surprise.

## What it does
- **Dashboard** with live numbers: total products, low-stock items, out-of-stock items, total units (all calculated from your real data)
- **Overview, Inventory, Low Stock, Reorder List** tabs; forms open in small pop-ups, so there is very little scrolling
- **Add / Edit / Delete** products (name, SKU, quantity, reorder threshold); duplicate SKUs are blocked
- **Sell** (stock goes down, can never go below 0) and **Restock** (stock goes up)
- **Search** products by name or SKU
- **Low-stock alerts**: low (amber) and out of stock (red) look different
- **Reorder list**: most urgent first, suggested order quantity, **Copy Reorder List** button, double-checked by the Python API
- Data is saved on the device (`localStorage`) and the app is cached by a service worker, so it works offline
- Works on desktop, tablet and phone (bottom navigation on small screens)

## Stock rules (the whole "brain")
| Rule | Formula |
|------|---------|
| Low stock | `quantity <= threshold` (includes out of stock) |
| Out of stock | `quantity == 0` |
| Order quantity | `max(threshold * 2 - quantity, 1)` |
| Reorder order | biggest shortage (`threshold - quantity`) first, then name |

These live in `public/stock.js` (browser) and `api/reorder.py` (server) and are tested in both languages.
No AI is used: stock numbers must be exact and predictable. No prices are stored, so no rupee amounts are shown.

## Structure
```
public/            frontend (HTML, CSS, vanilla JS), icon, service worker
  stock.js         all stock rules (no DOM)
  app.js           UI: tabs, modals, rendering
api/reorder.py     Python serverless function: POST /api/reorder
dev_server.py      run everything locally without the Vercel CLI
tests/             node + python tests
vercel.json        serves public/, deploys api/
```

## Run locally (Windows PowerShell)
```powershell
python dev_server.py
# open http://localhost:3000
```
Click the **...** menu (top right) and choose **Load demo data** to see alerts and the reorder list straight away.

## Test
```powershell
node --test
python -m unittest discover -s tests -v
```

## Deploy
Push this repo to GitHub, import it in Vercel (Framework: **Other**, no build command), click Deploy.
Site and API deploy from this one repo. No environment variables or secrets are needed.

## Team
- Preeti Sharma - Frontend
- Ashish Kumar Prajapati - Project Manager and integration
- Anirudh Gupta - AI integration
- Vivek Gupta - Backend

## Known limits
- Data lives per browser/device; there is no login or multi-device sync.
- The API is stateless: it only computes the reorder list from what the browser sends.
- Stock corrections made with **Edit** are not written to the activity log.
- No barcode scanning and no AI features yet.
