# Red Haven

A mobile-minded collection of low-poly 3D games and tools, including a colony survival prototype set on a habitable Mars. The colony game has Expedition and Endless modes, construction, automated colonists, gathering, raids, random events, and local saves. The hub also includes Snakes, Tetris, Arrange Numbers, Spell It!, Color Pour, Frostfall, the Body Mechanics pose studio, Tumble Temple, and Little Cup Plaza. The site is PWA-ready for offline play.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For a production build, run `npm run build`. The static output is in `dist/`. Push the repository to GitHub with a `main` branch, then select **GitHub Actions** as the Pages source in the repository settings. The included workflow builds and deploys `dist/` on each push to `main`. The Vite base is relative, so project subpaths work. GitHub Pages provides HTTPS for PWA installation and offline caching.

## Controls

- On the landing page, choose a game. Arrange Numbers lets you enter a whole-number range from 0–9999, with up to 60 blocks per round.
- In Arrange Numbers, tap blocks in ascending order. Correct blocks roll to the wall; wrong blocks burst and reappear in a new free spot. Drag or wheel-scroll to explore, pinch or use +/− to zoom, and use Center to reset the view. The Mars scene has 15 rotating background events; the comet button starts the next one. Sound effects can be muted.
- In Spell It!, look at the picture on the billboard and tap the letter blocks in order; correct letters roll onto the shelf, wrong ones burst and come back. The word is read aloud when finished. Settings (from the menu) turn words on or off, add your own words with a picture, and change sound, voice, hints, faint shelf letters and the number of extra letters. 15 gentle Mars sky events happen in the background.
- In Color Pour, tap a bottle and then a compatible bottle to pour its top color. Swipe left or right to circle the board, pinch or use +/− (or the mouse wheel) to zoom. Each level starts as a solvable scramble; complete every single-color bottle to unlock the next stop on the scrollable Martian level map. Use Undo or Restart as needed. Stars, unlocked levels, and the sound setting are saved locally. The game has synthesized tap, pour, undo, and win sounds and supports number keys 1–9 for bottle selection.
- In Frostfall, walk your astronaut around an isometric Martian polar outpost (drag anywhere, WASD/arrows or tap the ground). Walk up to ice crystals, ore rocks and carbon rocks to gather ice, metal and fuel. The Heat Core burns fuel to keep the warm zone heated; outside it you get cold. Use Build to place pumps, drills, fuel stills, habitats, a workshop, ice walls, blaster turrets and tesla coils, and tap any building to upgrade it (the Heat Core level caps everything else). Recruit helper bots that gather on their own, research upgrades in the Workshop, grab supply drops, and survive blizzards and crawler waves every night. Progress saves locally.
- In Body Mechanics, drag the colorful controls around a low-poly mannequin or use precise joint sliders. Human-inspired limits prevent impossible joint rotations. Adjust torso, femur, shin, arm and other proportions; load strength-training presets; save reusable poses locally; and blend any number of saved poses into a looping animation.
- In Tumble Temple, swipe, use the arrow keys/WASD or the on-screen pad to flip a stone block end over end across floating gothic ruins, and stand it upright in the glowing pit. Three temples hold 22 levels each and add cracked flagstones that crumble behind you, stained glass that shatters under an upright block, and round and cross sigils that raise bridges. Every level is checked by a solver; par is the shortest solution. Press R to restart. Stars and unlocked levels are saved locally. Regenerate the levels with `node tools/gen-tumble-levels.mjs`.
- In Little Cup Plaza, grow one little café into a whole shopping mall. Drag to paint mall floor (walls go up on their own), add entrances, footpaths and car parks that link to the sidewalk, then place shop units with their doors facing the concourse (R rotates). Shoppers arrive by car, on foot and later by bus, each with wishes, a budget and needs (restrooms, food, rest). Run shops yourself (staff, prices, stock, upgrades) or lease them to tenants for rent. Hire janitors, security guards and technicians, research new licences (bakery to cinema and bowling) and upgrades in the office, and handle events such as power cuts, leaks, shoplifting rings, inspections and celebrity visits. Wages, upkeep and loan interest are paid at closing, followed by a daily report showing what shoppers wanted. Modes: Normal, Challenge, Expert and Sandbox (unlimited money). Keys: drag/wheel to pan and zoom, Q/E rotate view, Space pause, 1–3 speed. Progress saves locally.
- Tap/click a build card, then a highlighted empty tile to place it.
- Tap/click a rock or tree in Gather mode to mark it for harvesting.
- Tap/click a building, colonist, or tile in Inspect mode for details.
- Drag to pan, pinch or wheel to zoom. Use the speed button to pause or accelerate time.
- Saves are stored on this device in browser local storage. New Game replaces the current local save after confirmation.

## First playable scope

The simulation uses a deterministic seeded map, low-poly meshes made from primitives, instanced terrain, a fixed orthographic camera, and a capped active unit count. Expedition mode aims to construct and power a signal beacon while keeping the crew alive. Endless mode has no victory deadline. More advanced job scheduling, research, colony relationships, and multiplayer are future work.
