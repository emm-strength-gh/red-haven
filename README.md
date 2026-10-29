# Redhaven

A mobile-minded, low-poly 3D isometric colony survival game set on a habitable Mars. This is a playable prototype with Expedition and Endless modes, construction, automated colonists, gathering, raids, random events, local saves, and offline PWA support.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite. For a production build, run `npm run build`. The static output is in `dist/`. Push the repository to GitHub with a `main` branch, then select **GitHub Actions** as the Pages source in the repository settings. The included workflow builds and deploys `dist/` on each push to `main`. The Vite base is relative, so project subpaths work. GitHub Pages provides HTTPS for PWA installation and offline caching.

## Controls

- Tap/click a build card, then a highlighted empty tile to place it.
- Tap/click a rock or tree in Gather mode to mark it for harvesting.
- Tap/click a building, colonist, or tile in Inspect mode for details.
- Drag to pan, pinch or wheel to zoom. Use the speed button to pause or accelerate time.
- Saves are stored on this device in browser local storage. New Game replaces the current local save after confirmation.

## First playable scope

The simulation uses a deterministic seeded map, low-poly meshes made from primitives, instanced terrain, a fixed orthographic camera, and a capped active unit count. Expedition mode aims to construct and power a signal beacon while keeping the crew alive. Endless mode has no victory deadline. More advanced job scheduling, research, colony relationships, and multiplayer are future work.
