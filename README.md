# VR Home Tours — WebXR (Meta Quest, no Unity)

This is a lightweight **WebXR** app you can host anywhere and open in the **Meta Quest Browser**.
It displays **360° equirectangular videos** (immersive sphere) and **regular 2D videos** (on a curved screen).

## How to use

1. Host these files on any static web host (S3/Cloudflare Pages/Netlify/localhost).
2. Put your videos on the same host (or any HTTPS host) and list them in **tours.json**:
   ```json
   {
     "videos": [
       { "title": "123 Oak St — 360", "url": "https://your.cdn/oak_360.mp4", "mode": "360" },
       { "title": "123 Oak St — Highlights", "url": "https://your.cdn/oak_highlights.mp4", "mode": "2d" }
     ]
   }
   ```
   *If `mode` is missing, filenames that contain “360” are treated as 360.*

3. On the Quest, open the URL in **Meta Quest Browser** and press **Enter VR**.
   - You can also press **Add Local Videos** to sideload files from the headset’s Downloads folder.
   - Use the big blue in‑VR buttons (Prev / Play / Next).

## Notes
- Keep MP4 (H.264/AAC) for best compatibility.
- If videos fail to autoplay in VR, press **Play** once to satisfy the browser’s user‑gesture policy.
- The 2D screen is gently curved (95° FOV) at ~2.2m; adjust in `app.js` (buildCurvedScreen).
- For branding/custom UI, you can change the 3D panel or add logos in the scene.

## Local testing
Serve a local folder with a static server, e.g.:
```bash
# Python 3
cd /path/to/site
python -m http.server 8080
```
Then open `http://<your-pc-ip>:8080` in the Quest Browser (both devices on same Wi‑Fi).

Enjoy!
