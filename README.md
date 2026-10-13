# 🦤 PELICO MANIA

An open-source *Elasto Mania* tribute featuring a pelican riding an elastic-suspension trials bike across **56 mountain-walled coastal stages**.

🌐 **Play Live:** [https://bukati.github.io/pelico-mania/](https://bukati.github.io/pelico-mania/)

## ✨ Features

- **360Hz Elastic Suspension Physics**: Sub-stepped spring-mass-damper bike physics with independent front and rear coil springs, progressive bump-stops, anti-squat swingarm geometry, and *Elasto Mania*-style air pitch / volt snap.
- **Acceleration Momentum & Wing Boost**: Hold gas down valleys to charge **100% Overdrive Momentum** for higher ramp rebound launches, or hold `Shift` to flap the pelican's wings for extra climb thrust and air lift.
- **56 Coastal & Mountain Stages**:
  - **6 Biomes**: *Pelican Bay*, *Sunset Red Canyon*, *Crystal Reef*, *Alpine Fjord*, *Golden Atoll*, and *Twilight Volcano*.
  - **Towering Mountain Walls**: Every stage is enclosed by 50m+ mountain walls at both ends, plus buoyant ocean water and automatic Pelican Sea-Lift recovery.
  - **7 Golden Fish per Stage**: Catch all 7 Golden Fish (watching the pelican's orange throat pouch swell!) to unlock the Goal Nest.
- **Zero Dependencies**: Pure HTML5 Canvas, CSS3, and Vanilla JavaScript (`index.html`, `style.css`, `game.js`) with a built-in Web Audio synthesizer and ghost replay system.

## 🎮 Controls

| Key | Action |
| :--- | :--- |
| **`W` / `↑`** | Accelerate & Build Momentum |
| **`S` / `↓`** | Brake |
| **`A` / `D`** or **`←` / `→`** | Lean Back / Lean Forward / Air Flips |
| **`Shift`** | Wing Flap Boost |
| **`E` / `C`** | Suspension Bunny-Hop |
| **`Space`** | Flip Bike Direction |
| **`R`** | Restart Stage |
| **`Esc`** | Return to Title Screen |

## 🚀 Running Locally

Open `index.html` directly in any modern browser, or serve locally:

```bash
python3 -m http.server 8123
# Open http://localhost:8123
```

## 📄 License

Released under the [MIT License](./LICENSE).
