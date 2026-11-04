# Red Haven

A mobile-minded collection of low-poly 3D games, including a colony survival prototype set on a habitable Mars. The colony game has Expedition and Endless modes, construction, automated colonists, gathering, raids, random events, and local saves. The hub also includes Snakes, Tetris, Arrange Numbers, Spell It!, and Color Pour. The site is PWA-ready for offline play.

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
- Tap/click a build card, then a highlighted empty tile to place it.
- Tap/click a rock or tree in Gather mode to mark it for harvesting.
- Tap/click a building, colonist, or tile in Inspect mode for details.
- Drag to pan, pinch or wheel to zoom. Use the speed button to pause or accelerate time.
- Saves are stored on this device in browser local storage. New Game replaces the current local save after confirmation.

## First playable scope

The simulation uses a deterministic seeded map, low-poly meshes made from primitives, instanced terrain, a fixed orthographic camera, and a capped active unit count. Expedition mode aims to construct and power a signal beacon while keeping the crew alive. Endless mode has no victory deadline. More advanced job scheduling, research, colony relationships, and multiplayer are future work.
