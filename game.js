// ============================================================================
// PELICO MANIA — Elastic Pelican Bike Physics Engine (Elasto Mania Tribute)
// ============================================================================

(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // HUD & Welcome Screen Elements
  const elWelcomeScreen = document.getElementById('welcomeScreen');
  const elWelcomeCourseStrip = document.getElementById('welcomeCourseStrip');
  const elHudTop = document.getElementById('hud-top');
  const elHudTelemetry = document.getElementById('hud-telemetry');
  const elHudControls = document.getElementById('hud-controls');
  const elTouchControls = document.getElementById('touch-controls');

  const elLevelName = document.getElementById('levelNameDisplay');
  const elFishCount = document.getElementById('fishCountDisplay');
  const elFishIconsRow = document.getElementById('fishIconsRow');
  const elFishPill = document.getElementById('fishPill');
  const elTimer = document.getElementById('timerDisplay');
  const elBestTime = document.getElementById('bestTimeDisplay');
  const elSpeedValue = document.getElementById('speedValue');
  const elDriveState = document.getElementById('driveStateValue');
  const elMomentumBar = document.getElementById('momentumBar');
  const elAccelChainPct = document.getElementById('accelChainPct');
  const elBoostBar = document.getElementById('boostBar');
  const elBoostPct = document.getElementById('boostPct');
  const elStuntFeed = document.getElementById('stuntFeed');
  const elStateOverlay = document.getElementById('stateOverlay');
  const elOverlayBadge = document.getElementById('overlayBadge');
  const elOverlayIcon = document.getElementById('overlayIcon');
  const elOverlayTitle = document.getElementById('overlayTitle');
  const elOverlaySubtitle = document.getElementById('overlaySubtitle');
  const elOverlayStats = document.getElementById('overlayStats');

  // Modals & Drawers
  const elPhysicsDrawer = document.getElementById('physicsDrawer');
  const elLevelModal = document.getElementById('levelModal');
  const elLevelGrid = document.getElementById('levelGrid');

  let isWelcomeOpen = true;

  // Tunable Physics Multipliers (linked to Physics Lab sliders)
  const tuning = {
    torque: 1.00,
    topSpeed: 1.00,
    spring: 1.00,
    rebound: 1.10,
    pitch: 1.05,
    gravity: 1.00,
  };

  // Base Constants (Meters, Seconds, Radians; 1 meter = 42 pixels at 1.0 zoom)
  const PIXELS_PER_METER = 42;
  const SUBSTEPS = 6; // 60fps * 6 = 360Hz internal solver for rock-solid elastic springs
  const WATER_LEVEL_Y = 6.2; // Scenic buoyant ocean surface

  // Balanced Elasto Mania speeds:
  // Base cruise ~ 34 km/h (9.5 m/s), Full Acceleration Momentum ~ 49 km/h (13.6 m/s),
  // Wing Flap Boost ~ 58 km/h (16.2 m/s). Never spirals out of control!
  const BASE_PARAMS = {
    gravity: 12.6,               // m/s^2 (floaty Elma feel)
    chassisMass: 2.6,
    chassisInertia: 2.3,
    wheelMass: 0.62,
    wheelRadius: 0.68,           // meters
    headRadius: 0.42,            // pelican helmet collision radius
    wheelBaseHalf: 1.22,         // half distance between wheels
    suspRestY: 0.96,             // wheel rest offset below chassis center
    suspMinY: 0.36,              // maximum compression bump-stop
    suspMaxY: 1.48,              // maximum extension droop
    springK_X: 295,              // lateral/swingarm alignment stiffness
    springDamp_X: 24,
    springK_Y: 190,              // vertical suspension stiffness
    springDamp_Y: 15.0,
    motorBaseOmega: 14.0,        // rad/s base wheel angular speed (~9.5 m/s = 34 km/h)
    motorMaxOmega: 20.0,         // rad/s overdrive wheel angular speed (~13.6 m/s = 49 km/h)
    motorTorqueRate: 18.0,       // smooth, controllable spin-up rate
    groundTraction: 19.0,        // governed tangential traction coupling
    maxHorizontalSpeed: 16.8,    // soft speed governor (~60 km/h max)
    turboThrust: 5.6,            // gentle wing-flap boost (assist climbs & air glide)
    turboLift: 4.4,              // upward wing-flap lift for higher jumps
    voltAngularAccel: 24.0,      // pitch authority (rad/s^2)
    voltSnapImpulse: 1.95,       // Elma-style alovolt snap when reversing lean
    maxAngularVel: 10.5,
    airDrag: 0.045,              // natural air resistance
  };

  // ============================================================================
  // WEB AUDIO SYNTHESIZER (Engine purr, Pelican squawk, Spring boing, Splash)
  // ============================================================================
  class SoundEngine {
    constructor() {
      this.enabled = true;
      this.ctx = null;
      this.engineOsc = null;
      this.engineGain = null;
    }

    init() {
      if (this.ctx) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();

        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 52;
        this.engineGain.gain.value = 0.0;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 240;

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();
      } catch (e) {
        // Audio context blocked or unavailable
      }
    }

    updateEngine(throttle, speedRatio, turbo, paused) {
      if (!this.ctx || !this.engineGain) return;
      if (!this.enabled || paused) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        return;
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const baseFreq = 45 + Math.min(1.2, speedRatio) * 85 + (throttle ? 24 : 0) + (turbo ? 30 : 0);
      const targetGain = throttle || turbo ? 0.04 : 0.012;
      this.engineOsc.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.04);
      this.engineGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.04);
    }

    playFishPickup(index) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const baseFreq = 520 + index * 90;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.16);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    }

    playHop() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.18);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    }

    playSplash() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.25);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.29);
    }

    playSquawk(isWin = false) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      if (isWin) {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(554, now + 0.1);
        osc.frequency.setValueAtTime(659, now + 0.2);
        osc.frequency.setValueAtTime(880, now + 0.32);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.56);
      } else {
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.linearRampToValueAtTime(180, now + 0.28);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.31);
      }
    }
  }

  const sound = new SoundEngine();

  // ============================================================================
  // LEVEL DEFINITIONS (With Proper Island Landmasses, Floating Decks & Ocean)
  // ============================================================================
  function catmullRomChain(points, subdivisions = 8) {
    if (points.length < 3) return points;
    const result = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const steps = p1.sharp ? 1 : subdivisions;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const x =
          0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y =
          0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        result.push([x, y]);
      }
    }
    result.push(points[points.length - 1]);
    return result;
  }

  function buildLoopSegments(cx, cy, radius, startAngle, endAngle, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + ((endAngle - startAngle) * i) / steps;
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return pts;
  }

  // Each structure in a level has an explicit `type`:
  // - 'island': continuous mountain-walled terrain that extends 250m behind the left & right
  //             mountain walls and deep underground so you can NEVER fall off a cliff!
  // - 'deck': thick wooden boardwalk / floating cliff shelf (open sky underneath, with wooden support pilings!)
  // - 'loop': stunt loop track with truss supports
  const LEVELS = [
    {
      id: 0,
      name: '1. Pelican Pier & Mountain Cove',
      desc: 'Expansive 230m coastal valley enclosed by towering mountain walls, rolling hills, and upper pier decks.',
      theme: { skyTop: '#1f6fb5', skyBot: '#8bd3f7', groundFill: '#332419', subSoil: '#4f3724', groundTop: '#52d669', deckColor: '#c9833e', mtnBack: '#3c78a8', mtnMid: '#26537a' },
      start: [0, -1.5],
      goal: [208, -8.8],
      minX: -18,
      maxX: 226,
      fish: [
        [18, -1.2],
        [44, -6.8],
        [68, -13.2], // Upper boardwalk deck 1
        [98, -3.5],
        [132, -9.8],
        [162, -15.2], // Upper boardwalk deck 2
        [188, -8.5],
      ],
      structures: [
        {
          type: 'island',
          points: catmullRomChain([
            [-18, -52.0], // Left Mountain Peak (visible right behind start!)
            [-14, -32.0],
            [-10, -14.0],
            [-6.5, -3.2],
            [-3.5, 0.0],
            [0, 0.0],     // Start Pier
            [10, 0.0],
            [20, 1.5],
            [32, 2.2],
            [40, -1.5],
            [46, -4.5],   // Kicker Ramp 1
            [53, -0.5],
            [64, -2.5],
            [76, -2.5],
            [88, 1.8],    // Valley 2
            [100, 2.2],
            [112, -1.8],
            [124, -5.8],  // Camelback Peak
            [134, -2.2],
            [144, 0.8],   // Valley 3
            [154, -3.5],
            [162, -5.5],
            [174, -4.0],
            [186, -6.8],
            [198, -7.2],
            [211, -7.2],  // Goal Nest Terrace
            [215, -10.5],
            [219, -22.0],
            [223, -38.0],
            [227, -56.0], // Right Mountain Peak (right behind Goal Nest!)
          ], 10),
        },
        // Floating upper wooden pier deck 1
        {
          type: 'deck',
          points: catmullRomChain([
            [54, -10.5],
            [68, -11.6],
            [82, -10.2],
          ], 6),
        },
        // Floating upper wooden pier deck 2
        {
          type: 'deck',
          points: catmullRomChain([
            [148, -12.6],
            [162, -13.6],
            [176, -12.2],
          ], 6),
        },
      ],
      killSpikes: [],
    },
    {
      id: 1,
      name: '2. Big Air Canyon Dunes',
      desc: 'Massive 260m desert canyon walled by red-rock mountains! Build momentum down sweeping dune valleys.',
      theme: { skyTop: '#3d1e54', skyBot: '#f08a4b', groundFill: '#422116', subSoil: '#663422', groundTop: '#f7b249', deckColor: '#c77738', mtnBack: '#733857', mtnMid: '#4f243d' },
      start: [0, -1.5],
      goal: [232, -10.2],
      minX: -18,
      maxX: 250,
      fish: [
        [24, 2.2],
        [50, -9.8],
        [84, -2.5],
        [114, -12.8],
        [148, 1.5],
        [178, -14.5],
        [210, -9.5],
      ],
      structures: [
        {
          type: 'island',
          points: catmullRomChain([
            [-18, -54],   // Left Canyon Mountain Wall
            [-14, -34],
            [-10, -15],
            [-6.5, -3.2],
            [-3.5, 0],
            [0, 0],
            [12, 0.5],
            [26, 4.2],    // Speed Valley 1
            [38, 3.5],
            [47, -3.6],   // Dune Launch 1
            [56, 1.5],
            [70, 3.6],
            [84, -1.2],
            [98, 4.5],    // Speed Valley 2
            [108, 1.2],
            [115, -5.2],  // Dune Launch 2
            [126, 0.5],
            [142, 4.8],   // Deep Canyon Bowl 3
            [156, 3.2],
            [168, -3.8],
            [176, -6.8],  // Dune Launch 3
            [188, -2.0],
            [202, -5.5],
            [218, -8.5],
            [235, -8.5],  // Goal Nest Terrace
            [239, -12.5],
            [243, -26.0],
            [248, -54.0], // Right Canyon Mountain Wall
          ], 10),
        },
        // High Canyon Mesa Deck
        {
          type: 'deck',
          points: catmullRomChain([
            [168, -12.5],
            [180, -13.2],
            [192, -12.0],
          ], 6),
        },
      ],
      killSpikes: [
        [62, 2.0],
      ],
    },
    {
      id: 2,
      name: '3. Elastic Loop & Mountain Cavern',
      desc: '240m mountain-enclosed course with a 360° loop-the-loop, rhythm valleys, and high cavern bridges.',
      theme: { skyTop: '#133a5e', skyBot: '#3ba3bf', groundFill: '#1c2938', subSoil: '#2b3f54', groundTop: '#3ef0d8', deckColor: '#38a3b8', mtnBack: '#215478', mtnMid: '#163b57' },
      start: [0, -1.5],
      goal: [214, -7.8],
      minX: -18,
      maxX: 232,
      fish: [
        [18, -1.8],
        [38, -16.8], // Top of the 360 loop!
        [66, -3.8],
        [88, -13.2], // Bridge 1
        [124, -4.5],
        [162, -14.8], // Bridge 2
        [194, -7.5],
      ],
      structures: [
        {
          type: 'island',
          points: catmullRomChain([
            [-18, -52],   // Left Mountain Wall
            [-14, -32],
            [-10, -14],
            [-6.5, -2.8],
            [-3.5, 0],
            [0, 0],
            [14, 0],
            [26, 1.2],
            [35, 1.0],
            [45, 1.0],
            [58, 0.5],
            [68, -2.2],
            [80, -2.2],
            [92, -5.8],
            [104, -5.5],
            [116, -1.0],  // Rhythm Valley
            [128, -3.8],
            [140, 0.5],
            [152, -4.5],
            [166, -6.2],
            [180, -3.5],
            [194, -6.2],
            [217, -6.2],  // Goal Terrace
            [221, -10.5],
            [225, -26.0],
            [230, -52.0], // Right Mountain Wall
          ], 8),
        },
        // 360 Loop-the-loop track
        {
          type: 'loop',
          points: buildLoopSegments(38, -7.8, 8.8, Math.PI * 0.55, -Math.PI * 1.38, 36),
        },
        // Upper bridge deck 1
        {
          type: 'deck',
          points: catmullRomChain([
            [74, -11.0],
            [88, -12.0],
            [102, -10.6],
          ], 6),
        },
        // Upper bridge deck 2
        {
          type: 'deck',
          points: catmullRomChain([
            [148, -12.5],
            [162, -13.5],
            [176, -12.0],
          ], 6),
        },
      ],
      killSpikes: [],
    },
    {
      id: 3,
      name: '4. Lighthouse Mountain Climb',
      desc: 'Walled mountain valley with switchback wooden decks climbing to the high peak nest—no cliff drop-offs!',
      theme: { skyTop: '#216096', skyBot: '#7dc4e8', groundFill: '#2c333e', subSoil: '#434d5c', groundTop: '#8be864', deckColor: '#d1853b', mtnBack: '#396891', mtnMid: '#284969' },
      start: [0, -1.5],
      goal: [16, -24.8],
      minX: -18,
      maxX: 136,
      fish: [
        [20, -1.8],
        [45, -6.8],
        [78, -11.5],
        [108, -15.5],
        [76, -18.5],
        [44, -22.2],
        [24, -24.5],
      ],
      structures: [
        {
          type: 'island',
          points: catmullRomChain([
            [-18, -54],   // Left High Mountain Wall
            [-14, -34],
            [-10, -16],
            [-6.5, -3],
            [-3.5, 0],
            [0, 0],
            [18, 0],
            [32, -1.8],
            [44, -5.2],
            [60, -5.8],
            [74, -9.8],
            [90, -10.2],
            [104, -13.8],
            [120, -14.2], // Right turnaround terrace
            [124, -18.5],
            [129, -32.0],
            [134, -54.0], // Right High Mountain Wall
          ], 8),
        },
        // Switchback Deck 1 (Ride right to x=115, press Space to reverse left onto these decks!)
        {
          type: 'deck',
          points: catmullRomChain([
            [64, -16.8],
            [80, -16.8],
            [94, -15.2],
          ], 6),
        },
        // Switchback Deck 2 (Climbing left)
        {
          type: 'deck',
          points: catmullRomChain([
            [32, -20.5],
            [48, -20.5],
            [60, -18.8],
          ], 6),
        },
        // Top Lighthouse Goal Deck (Nested safely beside the left mountain wall)
        {
          type: 'deck',
          points: catmullRomChain([
            [-8, -25.5],
            [-2, -23.2],
            [26, -23.2],
          ], 6),
        },
      ],
      killSpikes: [],
    },
    {
      id: 4,
      name: '5. Pelican Lagoon & Archipelago',
      desc: '270m continuous island & shallow-lagoon rollercoaster bounded by coastal mountains—no bottomless pits!',
      theme: { skyTop: '#146aa0', skyBot: '#72e5eb', groundFill: '#38291d', subSoil: '#57402c', groundTop: '#ffda66', deckColor: '#d4873f', mtnBack: '#226c94', mtnMid: '#174e6e' },
      start: [0, -1.5],
      goal: [238, -8.5],
      minX: -18,
      maxX: 256,
      fish: [
        [24, -6.5],
        [58, -8.5],
        [94, -10.5],
        [130, -11.5],
        [166, -12.5],
        [198, -9.5],
        [222, -8.5],
      ],
      structures: [
        // Single continuous landmass with shallow sandy lagoon basins between island hills!
        {
          type: 'island',
          points: catmullRomChain([
            [-18, -52],   // Left Mountain Wall
            [-14, -32],
            [-10, -14],
            [-6.5, -2.5],
            [-3.5, 0],
            [0, 0],
            [12, 1.8],
            [24, -4.2],   // Island 1 Peak
            [36, 4.8],    // Shallow Sandy Lagoon 1
            [46, 4.8],
            [58, -5.8],   // Island 2 Peak
            [70, 4.8],    // Shallow Sandy Lagoon 2
            [82, 4.8],
            [94, -7.2],   // Island 3 Peak
            [106, 4.8],   // Shallow Sandy Lagoon 3
            [118, 4.8],
            [130, -8.2],  // Island 4 Peak
            [142, 4.8],   // Shallow Sandy Lagoon 4
            [154, 4.8],
            [166, -9.0],  // Island 5 Peak
            [180, -3.5],
            [196, -6.8],
            [216, -6.8],
            [241, -6.8],  // Goal Nest Terrace
            [245, -11.5],
            [249, -26.0],
            [254, -54.0], // Right Mountain Wall
          ], 10),
        },
      ],
      killSpikes: [],
    },
    {
      id: 5,
      name: '6. Mega Mountain Halfpipe',
      desc: 'Giant twin mountain halfpipe with a center spine transfer ramp and two high sky-decks!',
      theme: { skyTop: '#2b1b54', skyBot: '#9448a8', groundFill: '#241a38', subSoil: '#3a2959', groundTop: '#ff6ea7', deckColor: '#a66bff', mtnBack: '#492b75', mtnMid: '#311b52' },
      start: [0, -1.5],
      goal: [0, -22.8],
      minX: -68,
      maxX: 68,
      fish: [
        [-28, -9.5],
        [28, -9.5],
        [-44, -18.5],
        [44, -18.5],
        [-22, -17.8],
        [22, -17.8],
        [0, -17.5],
      ],
      structures: [
        {
          type: 'island',
          points: catmullRomChain([
            [-68, -56],   // Left Towering Halfpipe Mountain
            [-60, -38],
            [-50, -22],
            [-40, -9.5],
            [-26, -1.5],
            [-14, 1.8],
            [0, -2.2],    // Center Spine Transfer
            [14, 1.8],
            [26, -1.5],
            [40, -9.5],
            [50, -22],
            [60, -38],
            [68, -56],    // Right Towering Halfpipe Mountain
          ], 14),
        },
        // Left Mid-Air Deck
        {
          type: 'deck',
          points: catmullRomChain([
            [-28, -15.5],
            [-20, -16.0],
            [-12, -15.0],
          ], 5),
        },
        // Right Mid-Air Deck
        {
          type: 'deck',
          points: catmullRomChain([
            [12, -15.0],
            [20, -16.0],
            [28, -15.5],
          ], 5),
        },
        // High Center Sky-Island Goal Deck
        {
          type: 'deck',
          points: catmullRomChain([
            [-9, -21.2],
            [0, -21.2],
            [9, -21.2],
          ], 5),
        },
      ],
      killSpikes: [],
    },
  ];

  // ============================================================================
  // 50 ADDITIONAL CAMPAIGN STAGES (STAGES 7 THROUGH 56 — 56 STAGES TOTAL!)
  // ============================================================================
  const BIOME_THEMES = [
    {
      world: 'Pelican Bay',
      skyTop: '#1f6fb5', skyBot: '#8bd3f7',
      groundFill: '#332419', subSoil: '#543a26', groundTop: '#52d669',
      deckColor: '#c9833e', mtnBack: '#3c78a8', mtnMid: '#26537a',
    },
    {
      world: 'Sunset Red Canyon',
      skyTop: '#3d1e54', skyBot: '#f08a4b',
      groundFill: '#422116', subSoil: '#6e3724', groundTop: '#f7b249',
      deckColor: '#c77738', mtnBack: '#733857', mtnMid: '#4f243d',
    },
    {
      world: 'Crystal Reef',
      skyTop: '#133a5e', skyBot: '#3ba3bf',
      groundFill: '#1c2938', subSoil: '#2e445c', groundTop: '#3ef0d8',
      deckColor: '#38a3b8', mtnBack: '#215478', mtnMid: '#163b57',
    },
    {
      world: 'Alpine Fjord',
      skyTop: '#216096', skyBot: '#7dc4e8',
      groundFill: '#2c333e', subSoil: '#465163', groundTop: '#8be864',
      deckColor: '#d1853b', mtnBack: '#396891', mtnMid: '#284969',
    },
    {
      world: 'Golden Atoll',
      skyTop: '#146aa0', skyBot: '#72e5eb',
      groundFill: '#38291d', subSoil: '#5c432f', groundTop: '#ffda66',
      deckColor: '#d4873f', mtnBack: '#226c94', mtnMid: '#174e6e',
    },
    {
      world: 'Twilight Volcano',
      skyTop: '#2b1b54', skyBot: '#9448a8',
      groundFill: '#241a38', subSoil: '#3d2b5e', groundTop: '#ff6ea7',
      deckColor: '#a66bff', mtnBack: '#492b75', mtnMid: '#311b52',
    },
  ];

  const EXTRA_STAGE_NAMES = [
    'Seagull Slalom', 'Boardwalk Bounce', 'Tidal Wave Rollers', 'Lighthouse Leap', 'Sandbar Sprint',
    'Gale Force Gulch', 'Pelican Pouch Peak', 'Barnacle Bowl', 'Anchor Drop Valley', 'Driftwood Double',
    'Coral Kicker', 'Rip Current Ridge', 'Harbor Master Loop', 'Sunken Schooner', 'Albatross Alley',
    'Kelp ForestClimb', 'Dune Buggy Dip', 'Mirage Mega-Ramp', 'Cactus Canyon Loop', 'Sandstorm Switchback',
    'Oasis Overdrive', 'Scorpion Spine', 'Sunbaked Super-Pipe', 'Red Rock Rhythm', 'Coyote Cliffhangers',
    'Geyser Gorge', 'Obsidian Outcrop', 'Starlight Spire', 'Bioluminescent Bay', 'Manta Ray Mounds',
    'Kraken Loop-the-Loop', 'Poseidon Pier', 'Nautilus Switchback', 'Emerald Archipelago', 'Sapphire Surf',
    'Glacier Gap', 'Iceberg Halfpipe', 'Puffin Promenade', 'Snowcap Step-Ups', 'Fjord Flyer',
    'Avalanche Alley', 'Northern Lights Loop', 'Timberline Trials', 'Eagle Eyrie Climb', 'Cloud Nine Canyon',
    'Monsoon Mega-Jump', 'Typhoon Terrace', 'Caldera Corkscrew', 'Obsidian Peak', 'Grand Pelican Finale',
  ];

  function generate50CampaignLevels() {
    for (let i = 0; i < 50; i++) {
      const stageNum = 7 + i;
      const biome = BIOME_THEMES[i % BIOME_THEMES.length];
      const archetype = i % 5; // 0: Rollers & Decks, 1: Big Air Dunes, 2: Loop & Rhythm, 3: Mountain Climb, 4: Mega Bowl/Lagoon
      const title = `${stageNum}. ${EXTRA_STAGE_NAMES[i]}`;

      // Deterministic pseudo-random helper for stage i
      const rand = (seedOffset) => {
        const s = Math.sin((i + 1) * 12.9898 + seedOffset * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };

      const structures = [];
      const fish = [];
      const killSpikes = [];
      let goal = [220, -8.5];
      let minX = -18;
      let maxX = 248;
      let desc = '';

      if (archetype === 4 && i % 10 === 9) {
        // Boss Halfpipe & Spine Arena every 10th level!
        const halfWidth = 68 + Math.round(rand(1) * 14);
        const bowlDepth = 2.0 + rand(2) * 2.5;
        const spineHeight = -2.2 - rand(3) * 3.0;
        const goalY = -22.5 - Math.round(rand(4) * 4);

        minX = -halfWidth;
        maxX = halfWidth;
        goal = [0, goalY - 1.6];
        desc = `${biome.world} Boss Halfpipe! Pump the twin mountain walls and transfer over the center spine to reach the sky nest.`;

        structures.push({
          type: 'island',
          points: catmullRomChain([
            [-halfWidth, -56],
            [-halfWidth + 8, -38],
            [-halfWidth + 18, -22],
            [-halfWidth + 28, -9.5],
            [-26, -1.2],
            [-14, bowlDepth],
            [0, spineHeight],
            [14, bowlDepth],
            [26, -1.2],
            [halfWidth - 28, -9.5],
            [halfWidth - 18, -22],
            [halfWidth - 8, -38],
            [halfWidth, -56],
          ], 12),
        });

        structures.push({
          type: 'deck',
          points: catmullRomChain([
            [-30, -15.2],
            [-21, -15.8],
            [-12, -14.8],
          ], 5),
        });
        structures.push({
          type: 'deck',
          points: catmullRomChain([
            [12, -14.8],
            [21, -15.8],
            [30, -15.2],
          ], 5),
        });
        structures.push({
          type: 'deck',
          points: catmullRomChain([
            [-9, goalY],
            [0, goalY],
            [9, goalY],
          ], 5),
        });

        fish.push(
          [-26, -9.5],
          [26, -9.5],
          [-42, -18.0],
          [42, -18.0],
          [-21, -17.6],
          [21, -17.6],
          [0, goalY + 3.5]
        );
      } else {
        // Progressive 220m - 280m Mountain-Walled Coastal Course
        const numFeatures = 7 + (i % 3);
        const stepX = 26 + Math.round(rand(2) * 5);
        const ctrl = [
          [-18, -54],
          [-14, -34],
          [-10, -15],
          [-6.5, -3.0],
          [-3.5, 0],
          [0, 0],
          [10, 0],
        ];

        let curX = 10;
        let curY = 0;

        for (let f = 0; f < numFeatures; f++) {
          curX += stepX;
          const r1 = rand(f * 3 + 1);
          const r2 = rand(f * 3 + 2);

          if (archetype === 0) {
            // Coastal Rollers & Boardwalk Decks
            const valleyY = Math.min(4.2, curY + 2.0 + r1 * 2.5);
            const peakY = Math.max(-14.0, curY - 2.5 - r2 * 4.2);
            ctrl.push([curX - stepX * 0.45, valleyY]);
            ctrl.push([curX, peakY]);
            curY = peakY * 0.6;
          } else if (archetype === 1) {
            // Big Air Sweeping Dunes
            const deepValley = Math.min(4.8, 2.5 + r1 * 2.3);
            const launchLip = -3.8 - r2 * 4.5;
            ctrl.push([curX - stepX * 0.42, deepValley]);
            ctrl.push([curX, launchLip]);
            curY = -1.5;
          } else if (archetype === 2) {
            // Loop & Rhythm Cavern
            if (f === 1) {
              ctrl.push([curX - 10, 1.0]);
              ctrl.push([curX + 6, 1.0]);
              structures.push({
                type: 'loop',
                points: buildLoopSegments(curX - 2, -7.8, 8.8, Math.PI * 0.55, -Math.PI * 1.38, 36),
              });
              curX += 10;
              curY = 0.5;
            } else {
              const ry = (f % 2 === 0 ? 2.2 : -4.5) + (r1 - 0.5) * 2.5;
              ctrl.push([curX - stepX * 0.5, ry]);
              ctrl.push([curX, -1.5 - r2 * 3.5]);
            }
          } else if (archetype === 3) {
            // Progressive Mountain Climb
            curY -= 1.8 + r1 * 1.6;
            ctrl.push([curX - stepX * 0.45, curY + 1.2]);
            ctrl.push([curX, curY]);
          } else {
            // Sandy Lagoon Islands
            ctrl.push([curX - stepX * 0.55, 4.8]);
            ctrl.push([curX - stepX * 0.25, 4.8]);
            ctrl.push([curX, -4.5 - r2 * 4.2]);
          }
        }

        // Goal Terrace + Right Towering Mountain Wall
        const goalX = curX + 22;
        const goalTerraceY = Math.min(-4.5, Math.max(-18.0, curY - 2.0));
        ctrl.push([curX + 12, goalTerraceY]);
        ctrl.push([goalX + 5, goalTerraceY]);
        ctrl.push([goalX + 9, goalTerraceY - 4.5]);
        ctrl.push([goalX + 13, goalTerraceY - 20.0]);
        ctrl.push([goalX + 18, goalTerraceY - 48.0]);

        const mainPoints = catmullRomChain(ctrl, 9);
        structures.unshift({
          type: 'island',
          points: mainPoints,
        });

        goal = [goalX, goalTerraceY - 1.6];
        maxX = goalX + 18;

        // Helper to sample terrain Y at any X
        const sampleY = (tx) => {
          let bestY = 0;
          let bestD = Infinity;
          for (const p of mainPoints) {
            const d = Math.abs(p[0] - tx);
            if (d < bestD) {
              bestD = d;
              bestY = p[1];
            }
          }
          return bestY;
        };

        // Add 2 elevated wooden boardwalk decks along the course
        const deck1X = Math.round(goalX * 0.34);
        const deck1Y = sampleY(deck1X) - 7.8;
        structures.push({
          type: 'deck',
          points: catmullRomChain([
            [deck1X - 13, deck1Y + 0.5],
            [deck1X, deck1Y - 0.6],
            [deck1X + 13, deck1Y + 0.5],
          ], 5),
        });

        const deck2X = Math.round(goalX * 0.68);
        const deck2Y = sampleY(deck2X) - 8.2;
        structures.push({
          type: 'deck',
          points: catmullRomChain([
            [deck2X - 13, deck2Y + 0.5],
            [deck2X, deck2Y - 0.6],
            [deck2X + 13, deck2Y + 0.5],
          ], 5),
        });

        // Place 7 Golden Fish along the terrain & upper boardwalk decks
        for (let k = 1; k <= 7; k++) {
          const fx = Math.round((goalX - 16) * (k / 7.4));
          if (k === 3) {
            fish.push([deck1X, deck1Y - 2.0]);
          } else if (k === 5) {
            fish.push([deck2X, deck2Y - 2.0]);
          } else {
            const fy = sampleY(fx) - (2.4 + (k % 2) * 2.2);
            fish.push([fx, fy]);
          }
        }

        const styleNames = [
          'Rolling coastal boardwalks & twin upper decks',
          'Deep speed valleys & big-air dune kickers',
          '360° stunt loop & rhythm caverns',
          'High-altitude mountain ridge climb',
          'Island-hopping shallow sandy lagoons',
        ];
        desc = `${biome.world} • ${styleNames[archetype]} (${Math.round(goalX)}m course).`;
      }

      LEVELS.push({
        id: stageNum - 1,
        name: title,
        desc,
        theme: biome,
        start: [0, -1.5],
        goal,
        minX,
        maxX,
        fish,
        structures,
        killSpikes,
      });
    }
  }

  generate50CampaignLevels();

  // Convert level structures into segment list with normals and lengths
  function compileLevelGeometry(level) {
    const segments = [];
    for (const st of level.structures) {
      const poly = st.points;
      for (let i = 0; i < poly.length - 1; i++) {
        const ax = poly[i][0];
        const ay = poly[i][1];
        const bx = poly[i + 1][0];
        const by = poly[i + 1][1];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4) continue;
        const tx = dx / len;
        const ty = dy / len;
        // Normal pointing "up" (left-hand normal of left-to-right segment)
        const nx = ty;
        const ny = -tx;
        segments.push({
          ax, ay, bx, by,
          tx, ty, nx, ny, len,
          structureType: st.type,
          minX: Math.min(ax, bx) - 2.5,
          maxX: Math.max(ax, bx) + 2.5,
          minY: Math.min(ay, by) - 2.5,
          maxY: Math.max(ay, by) + 2.5,
        });
      }
    }
    return segments;
  }

  // ============================================================================
  // INPUT STATE
  // ============================================================================
  const keys = {
    throttle: false,
    brake: false,
    leanLeft: false,
    leanRight: false,
    boost: false,
    hop: false,
  };

  let prevLeanDir = 0;

  // ============================================================================
  // GAME & BIKE STATE
  // ============================================================================
  let currentLevelIdx = 0;
  let currentLevel = null;
  let levelSegments = [];
  let fishItems = [];
  let fishCollected = 0;

  let headCrashEnabled = true;
  let ghostEnabled = true;
  let bestTimes = {};
  let bestGhosts = {};
  let currentGhostRecording = [];
  let ghostFrameCursor = 0;

  let runTime = 0;
  let runStatus = 'playing'; // 'playing' | 'crashed' | 'won'
  let maxJumpMeters = 0;

  // Particles
  let particles = [];

  // Bike Physics Object
  let bike = null;

  function createBike(startX, startY) {
    const dir = 1;
    const wb = BASE_PARAMS.wheelBaseHalf;
    const sy = BASE_PARAMS.suspRestY;
    return {
      dir,
      dirSmooth: 1,
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      angle: 0,
      omega: 0,

      rearWheel: {
        x: startX - dir * wb,
        y: startY + sy,
        vx: 0,
        vy: 0,
        omega: 0,
        rot: 0,
        grounded: false,
        contactNormalX: 0,
        contactNormalY: -1,
        contactTangentX: 1,
        contactTangentY: 0,
        compression: 0,
      },
      frontWheel: {
        x: startX + dir * wb,
        y: startY + sy,
        vx: 0,
        vy: 0,
        omega: 0,
        rot: 0,
        grounded: false,
        contactNormalX: 0,
        contactNormalY: -1,
        contactTangentX: 1,
        contactTangentY: 0,
        compression: 0,
      },

      head: {
        x: startX,
        y: startY - 1.15,
      },

      // Pelican & Acceleration Mechanics
      momentumChain: 0,      // 0..1 progressive speed/jump build-up
      turboFuel: 1.0,        // 0..1 wing turbo meter
      hopCooldown: 0,
      wingFlapPhase: 0,
      beakOpen: 0,
      pouchFishCount: 0,
      neckBobAngle: 0,
      neckBobVel: 0,
      pedalPhase: 0,

      // Safe checkpoint & water buoyancy state
      lastSafeX: startX,
      lastSafeY: startY,
      lastSafeDir: 1,
      inWaterTime: 0,
      wasInWater: false,

      // Air / Stunt tracking
      airTime: 0,
      lastGroundedAngle: 0,
      lastGroundedY: startY,
      currentJumpHeight: 0,
    };
  }

  // Camera
  const camera = {
    x: 0,
    y: 0,
    zoom: 1.0,
    targetZoom: 1.0,
  };

  // ============================================================================
  // STUNT TOAST NOTIFICATIONS
  // ============================================================================
  function showStuntToast(text, color = '#ffd147') {
    if (isWelcomeOpen) return;
    const div = document.createElement('div');
    div.className = 'stunt-toast';
    div.style.borderColor = color;
    div.style.color = color;
    div.textContent = text;
    elStuntFeed.appendChild(div);
    while (elStuntFeed.children.length > 3) {
      elStuntFeed.firstChild.remove();
    }
    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.25s ease';
      setTimeout(() => div.remove(), 260);
    }, 1500);
  }

  // ============================================================================
  // LEVEL INITIALIZATION & RESET
  // ============================================================================
  function loadLevel(idx) {
    currentLevelIdx = (idx + LEVELS.length) % LEVELS.length;
    currentLevel = LEVELS[currentLevelIdx];
    levelSegments = compileLevelGeometry(currentLevel);

    fishItems = currentLevel.fish.map((pos, i) => ({
      id: i,
      x: pos[0],
      y: pos[1],
      baseY: pos[1],
      collected: false,
      phase: i * 1.3,
    }));
    fishCollected = 0;

    bike = createBike(currentLevel.start[0], currentLevel.start[1]);
    maxJumpMeters = 0;
    runTime = 0;
    runStatus = 'playing';
    particles = [];
    currentGhostRecording = [];
    ghostFrameCursor = 0;

    camera.x = bike.x;
    camera.y = bike.y - 1.5;
    camera.zoom = 1.0;

    elStateOverlay.classList.add('hidden');
    renderFishPips();
    updateHUD();
    renderLevelGrid();
    renderWelcomeCourses();
  }

  function openWelcomeScreen() {
    isWelcomeOpen = true;
    elWelcomeScreen.classList.remove('hidden');
    elHudTop.classList.add('hud-hidden');
    elHudTelemetry.classList.add('hud-hidden');
    elHudControls.classList.add('hud-hidden');
    elTouchControls.classList.add('hud-hidden');
    elStateOverlay.classList.add('hidden');
    elLevelModal.classList.add('hidden');
    sound.updateEngine(false, 0, false, true);
    loadLevel(currentLevelIdx);
  }

  function startPlayingLevel(idx = currentLevelIdx) {
    isWelcomeOpen = false;
    keys.throttle = false;
    keys.brake = false;
    keys.leanLeft = false;
    keys.leanRight = false;
    keys.boost = false;
    keys.hop = false;
    elWelcomeScreen.classList.add('hidden');
    elHudTop.classList.remove('hud-hidden');
    elHudTelemetry.classList.remove('hud-hidden');
    elHudControls.classList.remove('hud-hidden');
    elTouchControls.classList.remove('hud-hidden');
    loadLevel(idx);
  }

  // Pelican Sea-Lift Rescue: smoothly returns the pelican to the last dry platform
  // without losing collected fish or resetting the run!
  function rescueToLastSafeSpot(reasonText) {
    const sx = bike.lastSafeX;
    const sy = bike.lastSafeY - 1.2;
    const sdir = bike.lastSafeDir || 1;
    const wb = BASE_PARAMS.wheelBaseHalf;
    const restY = BASE_PARAMS.suspRestY;

    bike.x = sx;
    bike.y = sy;
    bike.vx = 0;
    bike.vy = -2.5; // gentle upward wing hop on arrival
    bike.angle = 0;
    bike.omega = 0;
    bike.dir = sdir;
    bike.dirSmooth = sdir;
    bike.inWaterTime = 0;
    bike.wasInWater = false;

    bike.rearWheel.x = sx - sdir * wb;
    bike.rearWheel.y = sy + restY;
    bike.rearWheel.vx = 0;
    bike.rearWheel.vy = -2.5;
    bike.rearWheel.omega = 0;

    bike.frontWheel.x = sx + sdir * wb;
    bike.frontWheel.y = sy + restY;
    bike.frontWheel.vx = 0;
    bike.frontWheel.vy = -2.5;
    bike.frontWheel.omega = 0;

    showStuntToast(reasonText, '#38d9ff');
    sound.playHop();

    for (let i = 0; i < 14; i++) {
      particles.push({
        x: sx + (Math.random() - 0.5) * 2,
        y: sy + (Math.random() - 0.5) * 1.5,
        vx: (Math.random() - 0.5) * 5,
        vy: -1 - Math.random() * 4,
        life: 0.55,
        maxLife: 0.55,
        size: 5 + Math.random() * 4,
        color: '#ffffff',
        type: 'feather',
      });
    }
  }

  function flipDirection() {
    if (runStatus !== 'playing') return;
    bike.dir *= -1;
    const tmp = {
      x: bike.rearWheel.x,
      y: bike.rearWheel.y,
      vx: bike.rearWheel.vx,
      vy: bike.rearWheel.vy,
      omega: -bike.frontWheel.omega,
      rot: bike.rearWheel.rot,
    };
    bike.rearWheel.x = bike.frontWheel.x;
    bike.rearWheel.y = bike.frontWheel.y;
    bike.rearWheel.vx = bike.frontWheel.vx;
    bike.rearWheel.vy = bike.frontWheel.vy;
    bike.rearWheel.omega = -bike.frontWheel.omega;

    bike.frontWheel.x = tmp.x;
    bike.frontWheel.y = tmp.y;
    bike.frontWheel.vx = tmp.vx;
    bike.frontWheel.vy = tmp.vy;
    bike.frontWheel.omega = tmp.omega;
  }

  function triggerHop() {
    if (runStatus !== 'playing' || bike.hopCooldown > 0) return;

    // If floating in the ocean, pressing Hop triggers immediate Pelican Wing-Lift!
    if (bike.y > WATER_LEVEL_Y - 1.2) {
      rescueToLastSafeSpot('🦤 PELICAN WING-LIFT BACK TO SHORE!');
      bike.hopCooldown = 0.5;
      return;
    }

    const anyGrounded = bike.rearWheel.grounded || bike.frontWheel.grounded;
    if (anyGrounded || bike.airTime < 0.16) {
      const nx = bike.rearWheel.grounded
        ? bike.rearWheel.contactNormalX
        : bike.frontWheel.grounded
        ? bike.frontWheel.contactNormalX
        : -Math.sin(bike.angle);
      const ny = bike.rearWheel.grounded
        ? bike.rearWheel.contactNormalY
        : bike.frontWheel.grounded
        ? bike.frontWheel.contactNormalY
        : -Math.cos(bike.angle);

      // Momentum-scaled bunny hop: higher Acceleration Momentum gives a higher vertical pop
      // without needing excessive horizontal speed!
      const momentumBonus = 1.0 + bike.momentumChain * 0.42;
      const hopImpulse = 6.6 * tuning.rebound * momentumBonus;

      bike.vx += nx * hopImpulse * 0.65;
      bike.vy += ny * hopImpulse;
      bike.rearWheel.vx += nx * hopImpulse * 0.55;
      bike.rearWheel.vy += ny * hopImpulse * 0.85;
      bike.frontWheel.vx += nx * hopImpulse * 0.65;
      bike.frontWheel.vy += ny * hopImpulse * 0.95;

      bike.hopCooldown = 0.4;
      bike.beakOpen = 0.6;
      sound.playHop();

      for (let i = 0; i < 10; i++) {
        particles.push({
          x: bike.x,
          y: bike.y + 0.6,
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.2) * 3.5,
          life: 0.42,
          maxLife: 0.42,
          size: 4 + Math.random() * 4,
          color: i % 2 === 0 ? '#ffffff' : '#38d9ff',
          type: 'feather',
        });
      }
    }
  }

  // ============================================================================
  // ELASTO MANIA SPRING-MASS-DAMPER PHYSICS STEP
  // ============================================================================
  function stepPhysics(dt) {
    if (runStatus !== 'playing') return;

    // On the Title Screen, the Pelican idles on the Start Pier ready to launch!
    if (isWelcomeOpen) {
      keys.throttle = false;
      keys.brake = true;
      keys.boost = false;
      bike.omega += (-bike.angle * 10.0 - bike.omega * 4.0) * dt;
    } else {
      runTime += dt;
    }

    if (bike.hopCooldown > 0) bike.hopCooldown = Math.max(0, bike.hopCooldown - dt);
    if (bike.beakOpen > 0) bike.beakOpen = Math.max(0, bike.beakOpen - dt * 2.5);

    bike.dirSmooth += (bike.dir - bike.dirSmooth) * Math.min(1, dt * 18);

    // 1. Update Acceleration Momentum Chain & Wing Turbo
    const bothOrRearGrounded = bike.rearWheel.grounded || bike.frontWheel.grounded;
    if (keys.throttle) {
      // Smooth 2.4-second ramp-up to 100% Overdrive Momentum
      const buildRate = bothOrRearGrounded ? 0.42 : 0.15;
      bike.momentumChain = Math.min(1.0, bike.momentumChain + dt * buildRate);
    } else if (keys.brake) {
      bike.momentumChain = Math.max(0, bike.momentumChain - dt * 1.5);
    } else {
      bike.momentumChain = Math.max(0, bike.momentumChain - dt * 0.4);
    }

    const usingTurbo = keys.boost && bike.turboFuel > 0.02;
    if (usingTurbo) {
      bike.turboFuel = Math.max(0, bike.turboFuel - dt * 0.45);
      bike.momentumChain = Math.min(1.0, bike.momentumChain + dt * 0.65);
      bike.wingFlapPhase += dt * 24;

      // Subtle wing feather & golden breeze trail (not an overwhelming fireball)
      if (Math.random() < 0.35) {
        const backX = bike.x - Math.cos(bike.angle) * bike.dir * 0.9;
        const backY = bike.y - Math.sin(bike.angle) * bike.dir * 0.9;
        particles.push({
          x: backX,
          y: backY,
          vx: bike.vx * 0.2 - Math.cos(bike.angle) * bike.dir * 3 + (Math.random() - 0.5) * 2,
          vy: bike.vy * 0.2 - Math.sin(bike.angle) * bike.dir * 3 + (Math.random() - 0.5) * 2,
          life: 0.26,
          maxLife: 0.26,
          size: 3 + Math.random() * 3,
          color: Math.random() < 0.5 ? '#ffffff' : '#ffd147',
          type: 'feather',
        });
      }
    } else {
      const rechargeRate = bothOrRearGrounded ? 0.3 : 0.1;
      bike.turboFuel = Math.min(1.0, bike.turboFuel + dt * rechargeRate);
      bike.wingFlapPhase += dt * (3.5 + bike.momentumChain * 6);
    }

    // Elma Alovolt / Lean snap detection
    const currentLeanDir = (keys.leanRight ? 1 : 0) - (keys.leanLeft ? 1 : 0);
    if (currentLeanDir !== 0 && currentLeanDir !== prevLeanDir) {
      bike.omega += currentLeanDir * BASE_PARAMS.voltSnapImpulse * tuning.pitch;
      prevLeanDir = currentLeanDir;
    } else if (currentLeanDir === 0) {
      prevLeanDir = 0;
    }

    if (keys.hop) {
      triggerHop();
    }

    // Run 360Hz substeps
    const subDt = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      stepSubPhysics(subDt, usingTurbo, currentLeanDir);
    }

    // Record safe dry platform checkpoint when both wheels are grounded on an island/deck
    if (
      bike.rearWheel.grounded &&
      bike.frontWheel.grounded &&
      bike.y < WATER_LEVEL_Y - 1.5 &&
      Math.abs(bike.angle) < 0.75
    ) {
      bike.lastSafeX = bike.x;
      bike.lastSafeY = bike.y;
      bike.lastSafeDir = bike.dir;
    }

    // Ocean Buoyancy & Friendly Pelican Sea-Lift Recovery!
    handleOceanAndBoundaries(dt);

    // Air-time, Jump Height & Flip Stunt Detection
    const isGroundedNow = bike.rearWheel.grounded || bike.frontWheel.grounded;
    if (!isGroundedNow && bike.inWaterTime === 0) {
      bike.airTime += dt;
      const heightAboveTakeoff = Math.max(0, bike.lastGroundedY - bike.y);
      if (heightAboveTakeoff > bike.currentJumpHeight) {
        bike.currentJumpHeight = heightAboveTakeoff;
      }
      if (heightAboveTakeoff > maxJumpMeters) {
        maxJumpMeters = heightAboveTakeoff;
      }

      const angleDelta = bike.angle - bike.lastGroundedAngle;
      if (Math.abs(angleDelta) >= Math.PI * 1.85) {
        const isBackflip = angleDelta * bike.dir < 0;
        bike.lastGroundedAngle = bike.angle;
        bike.turboFuel = Math.min(1.0, bike.turboFuel + 0.45);
        bike.momentumChain = Math.min(1.0, bike.momentumChain + 0.35);
        showStuntToast(
          isBackflip ? '🦤 PELICAN BACKFLIP! +45% TURBO' : '🦤 PELICAN FRONTFLIP! +45% TURBO',
          '#38e58b'
        );
        sound.playHop();
      }
    } else {
      if (bike.airTime > 0.55 && bike.currentJumpHeight > 3.2) {
        showStuntToast(`AIR LAUNCH: ${bike.currentJumpHeight.toFixed(1)}m HIGH!`, '#38d9ff');
      }
      bike.airTime = 0;
      bike.currentJumpHeight = 0;
      bike.lastGroundedY = Math.max(bike.rearWheel.y, bike.frontWheel.y);
      bike.lastGroundedAngle = bike.angle;
    }

    // Pelican secondary neck bobbing physics
    const targetNeck = -bike.omega * 0.12 - (keys.throttle ? 0.14 : 0) + (keys.brake ? 0.18 : 0);
    const neckSpring = (targetNeck - bike.neckBobAngle) * 65 - bike.neckBobVel * 9;
    bike.neckBobVel += neckSpring * dt;
    bike.neckBobAngle += bike.neckBobVel * dt;

    // Collect Fish & Check Goal
    checkFishAndGoal();

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 5.5 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Record ghost sample
    if (currentGhostRecording.length < 18000) {
      currentGhostRecording.push({
        x: bike.x,
        y: bike.y,
        angle: bike.angle,
        dir: bike.dir,
        rx: bike.rearWheel.x,
        ry: bike.rearWheel.y,
        fx: bike.frontWheel.x,
        fy: bike.frontWheel.y,
      });
    }

    const speed = Math.hypot(bike.vx, bike.vy);
    sound.updateEngine(keys.throttle && !isWelcomeOpen, speed / 15, usingTurbo && !isWelcomeOpen, isWelcomeOpen);
  }

  function handleOceanAndBoundaries(dt) {
    // 1. Soft Horizontal Course Boundaries (gentle coastal wind + turnaround assist)
    const minX = currentLevel.minX ?? -24;
    const maxX = currentLevel.maxX ?? 140;
    if (bike.x < minX) {
      bike.vx += (minX - bike.x) * 14 * dt;
      if (bike.x < minX - 8) {
        rescueToLastSafeSpot('🧭 COASTAL BOUNDARY — RETURNED TO COURSE!');
        return;
      }
    } else if (bike.x > maxX) {
      bike.vx -= (bike.x - maxX) * 14 * dt;
      if (bike.x > maxX + 8) {
        rescueToLastSafeSpot('🧭 COASTAL BOUNDARY — RETURNED TO COURSE!');
        return;
      }
    }

    // 2. Buoyant Ocean Surface (Pelicans float on water!)
    const lowestWheelY = Math.max(bike.rearWheel.y, bike.frontWheel.y, bike.y);
    if (lowestWheelY > WATER_LEVEL_Y) {
      if (!bike.wasInWater) {
        bike.wasInWater = true;
        sound.playSplash();
        for (let i = 0; i < 16; i++) {
          particles.push({
            x: bike.x + (Math.random() - 0.5) * 2.2,
            y: WATER_LEVEL_Y,
            vx: (Math.random() - 0.5) * 7,
            vy: -2 - Math.random() * 5,
            life: 0.55,
            maxLife: 0.55,
            size: 4 + Math.random() * 4,
            color: i % 2 === 0 ? '#e0f7ff' : '#38d9ff',
            type: 'splash',
          });
        }
      }

      bike.inWaterTime += dt;
      bike.wingFlapPhase += dt * 22;

      // Buoyant upward force + water drag + upright stabilization so the pelican floats nicely!
      const depth = Math.min(4.0, lowestWheelY - WATER_LEVEL_Y);
      const buoyancyAccel = depth * 26.0;
      bike.vy -= buoyancyAccel * dt;
      bike.rearWheel.vy -= buoyancyAccel * dt;
      bike.frontWheel.vy -= buoyancyAccel * dt;

      // Water drag & upright self-righting torque
      bike.vx *= 1 - 2.2 * dt;
      bike.vy *= 1 - 3.5 * dt;
      bike.omega += (-bike.angle * 12 - bike.omega * 5) * dt;

      // Allow paddling/skimming out with Gas/Turbo, or automatic Pelican Sea-Lift after 1.1s!
      if (keys.throttle || keys.boost) {
        bike.vx += bike.dir * 9.5 * dt;
        bike.vy -= 4.5 * dt;
      }

      if (bike.inWaterTime > 1.15) {
        rescueToLastSafeSpot('🌊 PELICAN SEA-LIFT! BACK ON DRY LAND!');
      }
    } else {
      bike.wasInWater = false;
      bike.inWaterTime = Math.max(0, bike.inWaterTime - dt * 2);
    }
  }

  function stepSubPhysics(dt, usingTurbo, leanDir) {
    const g = BASE_PARAMS.gravity * tuning.gravity;
    const cosA = Math.cos(bike.angle);
    const sinA = Math.sin(bike.angle);
    const ux = cosA;
    const uy = sinA;
    const vxAxis = -sinA;
    const vyAxis = cosA;

    let chassisFx = 0;
    let chassisFy = BASE_PARAMS.chassisMass * g;
    let chassisTorque = 0;

    // Controlled Wing Flap Boost (only assists up to maxHorizontalSpeed, plus upward jump lift!)
    if (usingTurbo) {
      const currentForwardSpeed = bike.vx * ux * bike.dir + bike.vy * uy * bike.dir;
      const maxTurboSpeed = BASE_PARAMS.maxHorizontalSpeed * tuning.topSpeed;
      const speedHeadroom = Math.max(0, 1 - currentForwardSpeed / maxTurboSpeed);

      const forwardThrust =
        BASE_PARAMS.turboThrust * tuning.torque * speedHeadroom * BASE_PARAMS.chassisMass;
      const upwardLift = BASE_PARAMS.turboLift * tuning.rebound * BASE_PARAMS.chassisMass;

      chassisFx += ux * bike.dir * forwardThrust;
      chassisFy += uy * bike.dir * forwardThrust - upwardLift;
    }

    // Rider Lean / Volt Torque
    if (leanDir !== 0) {
      chassisTorque +=
        leanDir * BASE_PARAMS.voltAngularAccel * tuning.pitch * BASE_PARAMS.chassisInertia;
    }

    // Solve Elastic Suspension for Rear and Front wheels
    const wheels = [
      { w: bike.rearWheel, localTargetX: -bike.dir * BASE_PARAMS.wheelBaseHalf, isRear: true },
      { w: bike.frontWheel, localTargetX: bike.dir * BASE_PARAMS.wheelBaseHalf, isRear: false },
    ];

    for (const item of wheels) {
      const w = item.w;
      const relX = w.x - bike.x;
      const relY = w.y - bike.y;

      const lx = relX * ux + relY * uy;
      const ly = relX * vxAxis + relY * vyAxis;

      const attachVelX = bike.vx - bike.omega * relY;
      const attachVelY = bike.vy + bike.omega * relX;
      const rvx = w.vx - attachVelX;
      const rvy = w.vy - attachVelY;

      const rvxLocal = rvx * ux + rvy * uy;
      const rvyLocal = rvx * vxAxis + rvy * vyAxis;

      const errX = lx - item.localTargetX;
      const errY = ly - BASE_PARAMS.suspRestY;

      // Progressive bump stop
      let kY = BASE_PARAMS.springK_Y * tuning.spring;
      if (ly < BASE_PARAMS.suspRestY) {
        const compRatio = Math.max(
          0,
          (BASE_PARAMS.suspRestY - ly) / (BASE_PARAMS.suspRestY - BASE_PARAMS.suspMinY)
        );
        w.compression = Math.min(1.2, compRatio);
        if (compRatio > 0.55) {
          kY *= 1 + (compRatio - 0.55) * 2.2 * tuning.rebound;
        }
      } else {
        w.compression = 0;
      }

      let dampY = BASE_PARAMS.springDamp_Y;
      if (rvyLocal > 0 && ly < BASE_PARAMS.suspRestY) {
        dampY /= Math.max(0.75, tuning.rebound * 0.92);
      }

      const fLocalX = -BASE_PARAMS.springK_X * errX - BASE_PARAMS.springDamp_X * rvxLocal;
      const fLocalY = -kY * errY - dampY * rvyLocal;

      const fwX = fLocalX * ux + fLocalY * vxAxis;
      const fwY = fLocalX * uy + fLocalY * vyAxis;

      chassisFx -= fwX;
      chassisFy -= fwY;
      const driveArmY = 0.12;
      chassisTorque += -lx * fLocalY + driveArmY * fLocalX;

      let wheelFx = fwX;
      let wheelFy = fwY + BASE_PARAMS.wheelMass * g;

      // Governed Motor Target Omega
      const maxOmega =
        (BASE_PARAMS.motorBaseOmega +
          (BASE_PARAMS.motorMaxOmega - BASE_PARAMS.motorBaseOmega) * bike.momentumChain) *
        tuning.topSpeed *
        (usingTurbo ? 1.15 : 1.0);

      if (keys.brake) {
        w.omega *= Math.max(0, 1 - 26 * dt);
      } else if (keys.throttle && item.isRear) {
        const targetOmega = bike.dir * maxOmega;
        const diff = targetOmega - w.omega;
        w.omega += diff * Math.min(1, BASE_PARAMS.motorTorqueRate * tuning.torque * dt);
        bike.pedalPhase += Math.abs(w.omega) * dt * 0.35;
      } else {
        w.omega *= 1 - 0.8 * dt;
      }

      w.vx += (wheelFx / BASE_PARAMS.wheelMass) * dt;
      w.vy += (wheelFy / BASE_PARAMS.wheelMass) * dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;

      solveWheelCollisions(w, item.isRear, dt, usingTurbo);

      w.rot += w.omega * dt;
    }

    // Integrate Chassis
    bike.vx += (chassisFx / BASE_PARAMS.chassisMass) * dt;
    bike.vy += (chassisFy / BASE_PARAMS.chassisMass) * dt;

    // Quadratic aerodynamic drag so speed never runs away on huge hills
    const totalSpeed = Math.hypot(bike.vx, bike.vy);
    const maxAllowed = BASE_PARAMS.maxHorizontalSpeed * tuning.topSpeed * (usingTurbo ? 1.15 : 1.0);
    const dragFactor =
      BASE_PARAMS.airDrag + (totalSpeed > maxAllowed ? (totalSpeed - maxAllowed) * 0.25 : 0);
    bike.vx *= Math.max(0, 1 - dragFactor * dt);
    bike.vy *= Math.max(0, 1 - BASE_PARAMS.airDrag * dt);

    bike.omega += (chassisTorque / BASE_PARAMS.chassisInertia) * dt;
    bike.omega *= 1 - 1.15 * dt;
    bike.omega = Math.max(
      -BASE_PARAMS.maxAngularVel,
      Math.min(BASE_PARAMS.maxAngularVel, bike.omega)
    );

    bike.x += bike.vx * dt;
    bike.y += bike.vy * dt;
    bike.angle += bike.omega * dt;

    // Update Pelican Head world position
    const headLocalX = -bike.dir * 0.12;
    const headLocalY = -1.28;
    bike.head.x = bike.x + headLocalX * ux + headLocalY * vxAxis;
    bike.head.y = bike.y + headLocalX * uy + headLocalY * vyAxis;

    checkHazardCollisions();
  }

  function solveWheelCollisions(w, isRear, dt, usingTurbo) {
    w.grounded = false;
    const r = BASE_PARAMS.wheelRadius;

    let bestPenetration = 0;
    let bestNx = 0;
    let bestNy = -1;
    let contactX = w.x;
    let contactY = w.y;

    // 1. Resolve geometric penetration across all nearby segments
    for (let i = 0; i < levelSegments.length; i++) {
      const seg = levelSegments[i];
      if (w.x < seg.minX || w.x > seg.maxX || w.y < seg.minY || w.y > seg.maxY) continue;

      const apx = w.x - seg.ax;
      const apy = w.y - seg.ay;
      const proj = Math.max(0, Math.min(seg.len, apx * seg.tx + apy * seg.ty));

      const closestX = seg.ax + seg.tx * proj;
      const closestY = seg.ay + seg.ty * proj;

      const dx = w.x - closestX;
      const dy = w.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < r * r && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const penetration = r - dist;

        w.x += nx * penetration;
        w.y += ny * penetration;
        w.grounded = true;

        if (penetration > bestPenetration) {
          bestPenetration = penetration;
          bestNx = nx;
          bestNy = ny;
          contactX = closestX;
          contactY = closestY;
        }
      }
    }

    if (!w.grounded) return;

    // 2. Apply normal & tangential impulses ONCE per substep using primary contact normal
    const nx = bestNx;
    const ny = bestNy;
    const tx = -ny;
    const ty = nx;

    w.contactNormalX = nx;
    w.contactNormalY = ny;
    w.contactTangentX = tx;
    w.contactTangentY = ty;

    const vn = w.vx * nx + w.vy * ny;
    if (vn < 0) {
      w.vx -= nx * vn * 1.02;
      w.vy -= ny * vn * 1.02;
    }

    const vt = w.vx * tx + w.vy * ty;
    const surfaceSpeed = w.omega * r;

    if (keys.brake) {
      const brakeImpulse = -vt * Math.min(1, 22 * dt);
      w.vx += tx * brakeImpulse;
      w.vy += ty * brakeImpulse;
      bike.vx += tx * brakeImpulse * 0.35;
      bike.vy += ty * brakeImpulse * 0.35;
    } else if (isRear && keys.throttle) {
      // Velocity-governed traction: pulls wheel & bike smoothly up to surfaceSpeed without runaway!
      const slip = surfaceSpeed - vt;
      // Only push forward if we haven't exceeded target surface speed in our drive direction
      const driveImpulse = slip * Math.min(1, BASE_PARAMS.groundTraction * tuning.torque * dt);
      w.vx += tx * driveImpulse;
      w.vy += ty * driveImpulse;
      bike.vx += tx * driveImpulse * 0.32;
      bike.vy += ty * driveImpulse * 0.32;

      // Speed-to-Height Ramp Pop: when ascending a ramp with Acceleration Momentum,
      // add controlled vertical lift so faster momentum = higher jumps!
      const goingUpSlope = -ty * bike.dir;
      if (goingUpSlope > 0.18 && Math.abs(vt) > 3.5) {
        const rampLift =
          goingUpSlope *
          Math.min(12, Math.abs(vt)) *
          0.22 *
          tuning.rebound *
          (1 + bike.momentumChain * 0.55) *
          dt;
        bike.vy -= rampLift;
        w.vy -= rampLift * 0.7;
      }

      if (Math.random() < 0.18 && Math.abs(slip) > 1.5) {
        particles.push({
          x: contactX,
          y: contactY,
          vx: -tx * bike.dir * (2.5 + Math.random() * 3.5) + nx * 1.5,
          vy: -ty * bike.dir * (2.5 + Math.random() * 3.5) + ny * 2.0,
          life: 0.28,
          maxLife: 0.28,
          size: 3 + Math.random() * 2.5,
          color: currentLevel.theme.groundTop,
          type: 'dirt',
        });
      }
    } else {
      // Rolling resistance & freewheel matching
      w.omega = vt / r;
      w.vx *= 1 - 0.15 * dt;
      w.vy *= 1 - 0.15 * dt;
    }
  }

  function checkHazardCollisions() {
    if (isWelcomeOpen) return; // Never crash during background attract mode

    // 1. Kill Spikes
    for (const sp of currentLevel.killSpikes) {
      const d1 = Math.hypot(bike.x - sp[0], bike.y - sp[1]);
      const d2 = Math.hypot(bike.rearWheel.x - sp[0], bike.rearWheel.y - sp[1]);
      const d3 = Math.hypot(bike.frontWheel.x - sp[0], bike.frontWheel.y - sp[1]);
      if (d1 < 1.1 || d2 < 0.9 || d3 < 0.9) {
        triggerCrash('POKED BY A SEA URCHIN SPIKE!');
        return;
      }
    }

    // 2. Elasto Mania Head Collision with Terrain (if Head Crash is enabled)
    if (!headCrashEnabled) return;

    const hr = BASE_PARAMS.headRadius;
    const hx = bike.head.x;
    const hy = bike.head.y;

    for (let i = 0; i < levelSegments.length; i++) {
      const seg = levelSegments[i];
      if (hx < seg.minX || hx > seg.maxX || hy < seg.minY || hy > seg.maxY) continue;

      const apx = hx - seg.ax;
      const apy = hy - seg.ay;
      const proj = Math.max(0, Math.min(seg.len, apx * seg.tx + apy * seg.ty));
      const cx = seg.ax + seg.tx * proj;
      const cy = seg.ay + seg.ty * proj;

      const distSq = (hx - cx) * (hx - cx) + (hy - cy) * (hy - cy);
      if (distSq < hr * hr) {
        triggerCrash('BONK! PELICAN HELMET HIT TERRAIN!');
        return;
      }
    }
  }

  function checkFishAndGoal() {
    for (const f of fishItems) {
      if (f.collected) continue;
      const dChassis = Math.hypot(bike.x - f.x, bike.y - f.y);
      const dRear = Math.hypot(bike.rearWheel.x - f.x, bike.rearWheel.y - f.y);
      const dFront = Math.hypot(bike.frontWheel.x - f.x, bike.frontWheel.y - f.y);
      const dHead = Math.hypot(bike.head.x - f.x, bike.head.y - f.y);

      if (dChassis < 1.65 || dRear < 1.45 || dFront < 1.45 || dHead < 1.55) {
        f.collected = true;
        fishCollected++;
        bike.pouchFishCount = fishCollected;
        bike.beakOpen = 1.0;
        bike.turboFuel = Math.min(1.0, bike.turboFuel + 0.35);
        sound.playFishPickup(fishCollected);

        for (let i = 0; i < 14; i++) {
          const ang = (Math.PI * 2 * i) / 14;
          particles.push({
            x: f.x,
            y: f.y,
            vx: Math.cos(ang) * (3 + Math.random() * 5),
            vy: Math.sin(ang) * (3 + Math.random() * 5),
            life: 0.5,
            maxLife: 0.5,
            size: 4 + Math.random() * 4,
            color: i % 2 === 0 ? '#ffd147' : '#38d9ff',
            type: 'sparkle',
          });
        }

        if (fishCollected === fishItems.length) {
          showStuntToast('ALL GOLDEN FISH CAUGHT! HEAD TO THE NEST!', '#38e58b');
        } else {
          showStuntToast(`GULP! GOLDEN FISH ${fishCollected}/${fishItems.length}`, '#ffd147');
        }
        renderFishPips();
      }
    }

    const gx = currentLevel.goal[0];
    const gy = currentLevel.goal[1];
    const dGoal = Math.min(
      Math.hypot(bike.x - gx, bike.y - gy),
      Math.hypot(bike.frontWheel.x - gx, bike.frontWheel.y - gy),
      Math.hypot(bike.rearWheel.x - gx, bike.rearWheel.y - gy)
    );

    if (dGoal < 1.95) {
      if (fishCollected >= fishItems.length) {
        triggerWin();
      } else if (Math.random() < 0.05) {
        showStuntToast(
          `COLLECT ALL ${fishItems.length} FISH FIRST! (${fishItems.length - fishCollected} LEFT)`,
          '#ff8a2b'
        );
      }
    }
  }

  function triggerCrash(reason) {
    if (runStatus !== 'playing') return;
    runStatus = 'crashed';
    sound.playSquawk(false);
    sound.updateEngine(false, 0, false, true);

    for (let i = 0; i < 24; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 8;
      particles.push({
        x: bike.head.x,
        y: bike.head.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 2.5,
        life: 0.85,
        maxLife: 0.85,
        size: 5 + Math.random() * 4,
        color: i % 3 === 0 ? '#ff8a2b' : '#ffffff',
        type: 'feather',
      });
    }

    if (elOverlayBadge) elOverlayBadge.textContent = 'WIPEOUT';
    if (elOverlayIcon) elOverlayIcon.innerHTML = '';
    elOverlayTitle.textContent = 'RUFFLED FEATHERS!';
    elOverlaySubtitle.textContent = reason;
    elOverlayStats.innerHTML = `
      <div class="overlay-stat-box"><span>FISH</span><strong>${fishCollected}/${fishItems.length}</strong></div>
      <div class="overlay-stat-box"><span>PEAK JUMP</span><strong>${maxJumpMeters.toFixed(1)}m</strong></div>
      <div class="overlay-stat-box"><span>TIME</span><strong>${formatTime(runTime)}</strong></div>
    `;
    elStateOverlay.classList.remove('hidden');
  }

  function triggerWin() {
    if (runStatus !== 'playing') return;
    runStatus = 'won';
    sound.playSquawk(true);
    sound.updateEngine(false, 0, false, true);

    const prevBest = bestTimes[currentLevelIdx];
    const isNewRecord = !prevBest || runTime < prevBest;
    if (isNewRecord) {
      bestTimes[currentLevelIdx] = runTime;
      bestGhosts[currentLevelIdx] = currentGhostRecording.slice();
    }

    if (elOverlayBadge) elOverlayBadge.textContent = isNewRecord ? 'NEW COURSE RECORD' : 'STAGE CLEAR';
    if (elOverlayIcon) elOverlayIcon.innerHTML = '';
    elOverlayTitle.textContent = isNewRecord ? 'NEW RECORD!' : 'COURSE COMPLETE!';
    elOverlaySubtitle.textContent = `Pelican delivered all ${fishItems.length} golden fish to the nest!`;
    elOverlayStats.innerHTML = `
      <div class="overlay-stat-box"><span>FINISH TIME</span><strong>${formatTime(runTime)}</strong></div>
      <div class="overlay-stat-box"><span>BEST TIME</span><strong>${formatTime(bestTimes[currentLevelIdx])}</strong></div>
      <div class="overlay-stat-box"><span>MAX JUMP</span><strong>${maxJumpMeters.toFixed(1)}m</strong></div>
    `;
    elStateOverlay.classList.remove('hidden');
    renderWelcomeCourses();
    renderLevelGrid();
  }

  // ============================================================================
  // RENDERING (Scenic Coastal World, Distinct Islands/Decks/Loops, Ocean & HUD)
  // ============================================================================
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function updateCamera(dt) {
    if (isWelcomeOpen) {
      // Place camera center 3.5m ABOVE the bike so the ground and Pelican sit in the
      // lower third of the screen, leaving the entire upper 68% open sky for the Title UI!
      const targetX = bike.x + 2.5;
      const targetY = bike.y - 3.5;
      camera.x += (targetX - camera.x) * Math.min(1, dt * 8.0);
      camera.y += (targetY - camera.y) * Math.min(1, dt * 8.0);
      camera.targetZoom = 1.05;
      camera.zoom += (camera.targetZoom - camera.zoom) * Math.min(1, dt * 4.0);
      return;
    }

    const speed = Math.hypot(bike.vx, bike.vy);
    const lookAheadX = bike.vx * 0.22 + bike.dir * 2.4;
    const lookAheadY = bike.vy * 0.14 - 2.3;

    const targetX = bike.x + lookAheadX;
    const targetY = bike.y + lookAheadY;

    camera.x += (targetX - camera.x) * Math.min(1, dt * 7.5);
    camera.y += (targetY - camera.y) * Math.min(1, dt * 7.5);

    const heightZoom = Math.min(0.28, bike.currentJumpHeight * 0.015);
    const speedZoom = Math.min(0.18, speed * 0.008);
    camera.targetZoom = Math.max(0.65, 1.0 - Math.max(heightZoom, speedZoom));
    camera.zoom += (camera.targetZoom - camera.zoom) * Math.min(1, dt * 3.5);
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const theme = currentLevel.theme;

    // 1. Sky Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, theme.skyTop);
    skyGrad.addColorStop(1, theme.skyBot);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Parallax Sun, Clouds, Distant Islands & Seagulls
    drawParallaxBackground(w, h);

    // 3. World Transform
    ctx.save();
    const scale = PIXELS_PER_METER * camera.zoom;
    ctx.translate(w * 0.5, h * 0.52);
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);

    // 4. Deep Background Ocean Swells (behind islands)
    drawOceanLayer(WATER_LEVEL_Y - 0.3, 'rgba(13, 62, 102, 0.65)', 0.22, 1.5);

    // 5. Terrain Structures (Islands, Wooden Boardwalk Decks, 360 Loops)
    drawTerrainStructures(theme);

    // 6. Start Sign, Boundary Buoys & Goal Pelican Nest
    drawStartAndGoal();

    // 7. Collectible Golden Fish
    drawFishItems();

    // 8. Kill Spikes
    drawSpikes();

    // 9. Ghost Replay Bike
    if (ghostEnabled && bestGhosts[currentLevelIdx]) {
      const ghostFrames = bestGhosts[currentLevelIdx];
      const idx = Math.min(ghostFrameCursor, ghostFrames.length - 1);
      if (ghostFrames[idx]) {
        drawGhostBike(ghostFrames[idx]);
      }
      if (runStatus === 'playing') ghostFrameCursor++;
    }

    // 10. Particles
    drawParticles();

    // 11. Active Pelican & Elastic Bike
    drawPelicanBike();

    // 12. Foreground Animated Ocean Waves & Whitecap Foam (in front of submerged wheels!)
    drawOceanLayer(WATER_LEVEL_Y, 'rgba(22, 118, 178, 0.52)', 0.28, 2.6, true);

    ctx.restore();

    // 13. Off-Screen Target Compass Indicator (points to next Fish or Goal if off-screen)
    drawOffscreenCompass(w, h);
  }

  function drawParallaxBackground(w, h) {
    const theme = currentLevel.theme;

    // 1. Warm Glowing Sun with crisp solar core
    const sunX = w * 0.78 - camera.x * 1.1;
    const sunY = h * 0.22 - camera.y * 0.5;
    const rad = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, 155);
    rad.addColorStop(0, 'rgba(255, 248, 195, 0.96)');
    rad.addColorStop(0.35, 'rgba(255, 200, 105, 0.38)');
    rad.addColorStop(1, 'rgba(255, 175, 90, 0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 155, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 250, 215, 0.92)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
    ctx.fill();

    // 2. Fluffy Coastal Clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 290 - camera.x * 3.2 + runTime * 4) % (w + 300) + (w + 300)) % (w + 300) - 150;
      const cy = h * 0.15 + (i % 3) * 46 - camera.y * 0.7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 62, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 32, cy + 4, 46, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 28, cy + 5, 42, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Animated Background Seagulls
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const gx = ((i * 230 + runTime * (18 + i * 3) - camera.x * 4) % (w + 160) + (w + 160)) % (w + 160) - 80;
      const gy = h * 0.24 + (i % 3) * 34 + Math.sin(runTime * 3 + i) * 6;
      const wingY = Math.sin(runTime * 7 + i * 1.7) * 5;
      ctx.beginPath();
      ctx.moveTo(gx - 9, gy + wingY);
      ctx.quadraticCurveTo(gx - 4, gy - 4, gx, gy);
      ctx.quadraticCurveTo(gx + 4, gy - 4, gx + 9, gy + wingY);
      ctx.stroke();
    }

    // 4. Far Parallax Alpine Mountain Range
    ctx.fillStyle = theme.mtnBack || '#3c78a8';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 30; x += 30) {
      const worldX = x + camera.x * 4.5;
      const peakY =
        h * 0.50 -
        Math.abs(Math.sin(worldX * 0.0032)) * 130 -
        Math.cos(worldX * 0.008) * 35 -
        camera.y * 1.4;
      ctx.lineTo(x, peakY);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 5. Mid-Ground Rugged Mountain Ridge
    ctx.fillStyle = theme.mtnMid || '#26537a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 30; x += 30) {
      const worldX = x + camera.x * 8.5;
      const hillY =
        h * 0.64 -
        Math.abs(Math.cos(worldX * 0.0045)) * 90 +
        Math.sin(worldX * 0.011) * 25 -
        camera.y * 2.2;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  function drawOceanLayer(surfaceY, fillColor, amp, speed, drawFoam = false) {
    const startX = Math.floor(camera.x - 55);
    const endX = Math.ceil(camera.x + 55);
    const deepY = surfaceY + 45;

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(startX, deepY);
    for (let x = startX; x <= endX; x += 1.5) {
      const wy =
        surfaceY +
        Math.sin(x * 0.45 + runTime * speed) * amp +
        Math.cos(x * 0.22 - runTime * speed * 0.7) * (amp * 0.5);
      ctx.lineTo(x, wy);
    }
    ctx.lineTo(endX, deepY);
    ctx.closePath();
    ctx.fill();

    if (drawFoam) {
      ctx.strokeStyle = 'rgba(210, 245, 255, 0.65)';
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += 1.5) {
        const wy =
          surfaceY +
          Math.sin(x * 0.45 + runTime * speed) * amp +
          Math.cos(x * 0.22 - runTime * speed * 0.7) * (amp * 0.5);
        if (x === startX) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
  }

  function drawTerrainStructures(theme) {
    for (const st of currentLevel.structures) {
      const poly = st.points;
      if (poly.length < 2) continue;

      if (st.type === 'island') {
        const first = poly[0];
        const last = poly[poly.length - 1];
        const deepEarthY = WATER_LEVEL_Y + 90;

        // 0. Scenic Coastal Pine Trees behind gentle hilltops
        for (let i = 6; i < poly.length - 6; i += 14) {
          const px = poly[i][0];
          const py = poly[i][1];
          const slope = Math.abs(poly[i + 1][1] - poly[i - 1][1]);
          if (slope < 0.7 && py < WATER_LEVEL_Y - 1.5 && Math.abs(px) > 5) {
            ctx.fillStyle = '#4a2e18';
            ctx.fillRect(px - 0.14, py - 1.6, 0.28, 1.8);
            ctx.fillStyle = '#24693d';
            ctx.beginPath();
            ctx.moveTo(px, py - 4.2);
            ctx.lineTo(px - 1.25, py - 1.4);
            ctx.lineTo(px + 1.25, py - 1.4);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#2f854e';
            ctx.beginPath();
            ctx.moveTo(px, py - 5.1);
            ctx.lineTo(px - 0.95, py - 2.6);
            ctx.lineTo(px + 0.95, py - 2.6);
            ctx.closePath();
            ctx.fill();
          }
        }

        // 1. Rich Warm Earth Gradient Fill
        const earthGrad = ctx.createLinearGradient(0, -10, 0, WATER_LEVEL_Y + 18);
        earthGrad.addColorStop(0, theme.subSoil || '#6e472b');
        earthGrad.addColorStop(0.45, theme.groundFill || '#3d2516');
        earthGrad.addColorStop(1, '#1c110a');
        ctx.fillStyle = earthGrad;
        ctx.beginPath();
        ctx.moveTo(first[0] - 240, deepEarthY);
        ctx.lineTo(first[0] - 240, first[1] - 18);
        ctx.lineTo(first[0] - 45, first[1] - 6);
        ctx.lineTo(first[0], first[1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.lineTo(last[0] + 45, last[1] - 6);
        ctx.lineTo(last[0] + 240, last[1] - 18);
        ctx.lineTo(last[0] + 240, deepEarthY);
        ctx.closePath();
        ctx.fill();

        // 2. Warm Topsoil Sub-Band just below the surface turf
        ctx.strokeStyle = theme.subSoil || '#7d5233';
        ctx.lineWidth = 0.85;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(first[0], first[1] + 0.45);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1] + 0.45);
        }
        ctx.stroke();

        // 3. Subtle Embedded Stones
        ctx.fillStyle = 'rgba(255, 235, 205, 0.08)';
        for (let i = 3; i < poly.length - 3; i += 5) {
          const rx = poly[i][0];
          const ry = poly[i][1] + 1.8 + (i % 3) * 1.1;
          ctx.beginPath();
          ctx.ellipse(rx, ry, 0.75, 0.38, (i % 4) * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }

        // 4. Lush Surface Turf & Mountain Ridge Ribbon
        ctx.strokeStyle = theme.groundTop;
        ctx.lineWidth = 0.45;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(first[0] - 240, first[1] - 18);
        ctx.lineTo(first[0] - 45, first[1] - 6);
        ctx.lineTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.lineTo(last[0] + 45, last[1] - 6);
        ctx.lineTo(last[0] + 240, last[1] - 18);
        ctx.stroke();
      } else if (st.type === 'deck') {
        // Floating Wooden Pier Boardwalk / Cliff Deck (0.85m thick, open underneath!)
        const thickness = 0.85;

        // Vertical wooden pier pilings at ends for coastal authenticity
        const first = poly[0];
        const last = poly[poly.length - 1];
        ctx.strokeStyle = 'rgba(110, 72, 35, 0.45)';
        ctx.lineWidth = 0.28;
        ctx.beginPath();
        ctx.moveTo(first[0] + 0.4, first[1] + thickness);
        ctx.lineTo(first[0] + 0.4, first[1] + 4.5);
        ctx.moveTo(last[0] - 0.4, last[1] + thickness);
        ctx.lineTo(last[0] - 0.4, last[1] + 4.5);
        ctx.stroke();

        // Deck body
        ctx.fillStyle = '#5c3a1e';
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        for (let i = poly.length - 1; i >= 0; i--) {
          ctx.lineTo(poly[i][0], poly[i][1] + thickness);
        }
        ctx.closePath();
        ctx.fill();

        // Cross-brace plank lines on the deck side
        ctx.strokeStyle = 'rgba(255, 220, 175, 0.22)';
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          ctx.moveTo(poly[i][0], poly[i][1]);
          ctx.lineTo(poly[i][0], poly[i][1] + thickness);
        }
        ctx.stroke();

        // Bright top riding surface
        ctx.strokeStyle = theme.deckColor || '#e09f5a';
        ctx.lineWidth = 0.3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.stroke();
      } else if (st.type === 'loop') {
        // 360° Loop-the-loop stunt track with outer rail
        ctx.strokeStyle = 'rgba(20, 38, 58, 0.85)';
        ctx.lineWidth = 0.72;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.stroke();

        ctx.strokeStyle = theme.groundTop;
        ctx.lineWidth = 0.28;
        ctx.stroke();
      }
    }
  }

  function drawStartAndGoal() {
    // Charming Coastal Start Pier Post with Red & White Lifebuoy & Pennant
    const sx = currentLevel.start[0] - 2.3;
    const sy = currentLevel.start[1] + 1.5;

    // Wooden dock bollard post
    ctx.fillStyle = '#7c4d25';
    ctx.fillRect(sx - 0.18, sy - 2.5, 0.36, 2.5);
    ctx.fillStyle = '#a36836';
    ctx.beginPath();
    ctx.arc(sx, sy - 2.5, 0.22, 0, Math.PI * 2);
    ctx.fill();

    // Fluttering Start Pennant
    ctx.fillStyle = '#ff8524';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 2.35);
    ctx.lineTo(sx + 1.45, sy - 1.95 + Math.sin(runTime * 6) * 0.08);
    ctx.lineTo(sx, sy - 1.55);
    ctx.closePath();
    ctx.fill();

    // Classic Red & White Lifebuoy Ring hung on the post
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy - 1.1, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.arc(sx, sy - 1.1, 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#332419';
    ctx.beginPath();
    ctx.arc(sx, sy - 1.1, 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Goal: Giant Cozy Pelican Nest + Pennant Flag
    const gx = currentLevel.goal[0];
    const gy = currentLevel.goal[1];
    const allCollected = fishCollected >= fishItems.length;
    const pulse = Math.sin(runTime * 5) * 0.12;

    ctx.save();
    ctx.translate(gx, gy);

    if (allCollected) {
      const grad = ctx.createRadialGradient(0, -0.4, 0.2, 0, -0.4, 2.6 + pulse);
      grad.addColorStop(0, 'rgba(56, 229, 139, 0.55)');
      grad.addColorStop(1, 'rgba(56, 229, 139, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, -0.4, 2.6 + pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, 0.8);
    ctx.lineTo(0, -2.2);
    ctx.stroke();

    ctx.fillStyle = allCollected ? '#38e58b' : '#ffd147';
    ctx.beginPath();
    ctx.moveTo(0, -2.2);
    ctx.lineTo(1.4, -1.75 + Math.sin(runTime * 6) * 0.1);
    ctx.lineTo(0, -1.3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#9c6631';
    ctx.beginPath();
    ctx.ellipse(0, 0.65, 1.25, 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#69411c';
    ctx.lineWidth = 0.08;
    ctx.stroke();

    ctx.restore();
  }

  function drawOffscreenCompass(w, h) {
    if (isWelcomeOpen) return;
    // Find nearest uncollected fish, or the goal nest if all fish are collected
    let targetX = currentLevel.goal[0];
    let targetY = currentLevel.goal[1];
    let label = 'NEST';
    let color = '#38e58b';

    if (fishCollected < fishItems.length) {
      let bestDist = Infinity;
      for (const f of fishItems) {
        if (f.collected) continue;
        const d = Math.hypot(f.x - bike.x, f.y - bike.y);
        if (d < bestDist) {
          bestDist = d;
          targetX = f.x;
          targetY = f.y;
          label = 'FISH';
          color = '#ffd147';
        }
      }
    }

    const scale = PIXELS_PER_METER * camera.zoom;
    const screenX = w * 0.5 + (targetX - camera.x) * scale;
    const screenY = h * 0.54 + (targetY - camera.y) * scale;

    const margin = 56;
    if (screenX >= margin && screenX <= w - margin && screenY >= margin && screenY <= h - margin) {
      return; // Target is visible on screen
    }

    const cx = Math.max(margin, Math.min(w - margin, screenX));
    const cy = Math.max(margin + 36, Math.min(h - margin - 40, screenY));
    const ang = Math.atan2(screenY - cy, screenX - cx);
    const distMeters = Math.round(Math.hypot(targetX - bike.x, targetY - bike.y));

    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = 'rgba(14, 25, 42, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.lineTo(18, -6);
    ctx.lineTo(18, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = color;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, -2);
    ctx.fillStyle = '#f2f7ff';
    ctx.fillText(`${distMeters}m`, 0, 9);

    ctx.restore();
  }

  function drawFishItems() {
    for (const f of fishItems) {
      if (f.collected) continue;
      const bobY = f.baseY + Math.sin(runTime * 4.2 + f.phase) * 0.24;
      const wag = Math.sin(runTime * 9 + f.phase) * 0.18;

      ctx.save();
      ctx.translate(f.x, bobY);
      ctx.rotate(wag);

      ctx.fillStyle = 'rgba(255, 209, 71, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, 0.95, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ff8a2b';
      ctx.beginPath();
      ctx.moveTo(-0.45, 0);
      ctx.lineTo(-0.85, -0.35);
      ctx.lineTo(-0.75, 0);
      ctx.lineTo(-0.85, 0.35);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffd147';
      ctx.beginPath();
      ctx.ellipse(0.05, 0, 0.55, 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff8a2b';
      ctx.lineWidth = 0.06;
      ctx.stroke();

      ctx.fillStyle = '#0c1624';
      ctx.beginPath();
      ctx.arc(0.32, -0.08, 0.07, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawSpikes() {
    for (const sp of currentLevel.killSpikes) {
      ctx.save();
      ctx.translate(sp[0], sp[1]);
      ctx.fillStyle = '#ff4961';
      const spikes = 10;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? 0.78 : 0.35;
        const a = (i * Math.PI) / spikes + runTime * 1.8;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      const sz = (p.size / PIXELS_PER_METER) * 1.2;
      if (p.type === 'feather') {
        ctx.rotate(p.life * 8);
        ctx.beginPath();
        ctx.ellipse(0, 0, sz * 1.5, sz * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawGhostBike(g) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#38d9ff';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(g.rx, g.ry, BASE_PARAMS.wheelRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(g.fx, g.fy, BASE_PARAMS.wheelRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.rx, g.ry);
    ctx.lineTo(g.x, g.y);
    ctx.lineTo(g.fx, g.fy);
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================================
  // DETAILED PELICAN ON AN ELASTO-BIKE RENDERER
  // ============================================================================
  function drawPelicanBike() {
    const rw = bike.rearWheel;
    const fw = bike.frontWheel;

    drawWheel(rw);
    drawWheel(fw);

    const cosA = Math.cos(bike.angle);
    const sinA = Math.sin(bike.angle);
    const d = bike.dir;

    const toWorld = (lx, ly) => [
      bike.x + (lx * d) * cosA - ly * sinA,
      bike.y + (lx * d) * sinA + ly * cosA,
    ];

    const pivotRear = toWorld(-0.35, 0.22);
    const seatPost = toWorld(-0.32, -0.32);
    const headTubeTop = toWorld(0.62, -0.38);
    const headTubeBot = toWorld(0.72, 0.08);
    const crankPos = toWorld(-0.05, 0.32);

    // Swingarm & Coiled Rear Shock
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotRear[0], pivotRear[1]);
    ctx.lineTo(rw.x, rw.y);
    ctx.stroke();

    drawCoilSpring(seatPost[0], seatPost[1], rw.x, rw.y, 6, 0.13, '#ff5468');

    // Telescopic Front Fork & Spring
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.moveTo(headTubeTop[0], headTubeTop[1]);
    ctx.lineTo(fw.x, fw.y);
    ctx.stroke();

    drawCoilSpring(headTubeBot[0], headTubeBot[1], fw.x, fw.y, 5, 0.11, '#38d9ff');

    // Bike Tubular Frame
    ctx.strokeStyle = '#ff8a2b';
    ctx.lineWidth = 0.16;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(seatPost[0], seatPost[1]);
    ctx.lineTo(headTubeTop[0], headTubeTop[1]);
    ctx.lineTo(crankPos[0], crankPos[1]);
    ctx.closePath();
    ctx.stroke();

    // Handlebars
    const handleGrip = toWorld(0.52, -0.62);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(headTubeTop[0], headTubeTop[1]);
    ctx.lineTo(handleGrip[0], handleGrip[1]);
    ctx.stroke();

    // Pelican Rider
    ctx.save();
    ctx.translate(bike.x, bike.y);
    ctx.rotate(bike.angle);
    ctx.scale(bike.dirSmooth || bike.dir, 1);

    const pedalX = -0.05 + Math.cos(bike.pedalPhase) * 0.18;
    const pedalY = 0.32 + Math.sin(bike.pedalPhase) * 0.18;

    // Far Leg
    ctx.strokeStyle = '#e06d1b';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(-0.32, -0.35);
    ctx.lineTo(-0.08, 0.02);
    ctx.lineTo(pedalX, pedalY);
    ctx.stroke();

    // Tail Feathers
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(-0.65, -0.38);
    ctx.lineTo(-1.05, -0.58);
    ctx.lineTo(-0.98, -0.35);
    ctx.lineTo(-1.08, -0.22);
    ctx.lineTo(-0.62, -0.22);
    ctx.closePath();
    ctx.fill();

    // Plump White Body
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(-0.22, -0.52, 0.52, 0.34, -0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.05;
    ctx.stroke();

    // Near Leg & Webbed Foot
    const kneeX = -0.02 + Math.cos(bike.pedalPhase) * 0.06;
    const kneeY = -0.08 + Math.sin(bike.pedalPhase) * 0.06;
    ctx.strokeStyle = '#ff8a2b';
    ctx.lineWidth = 0.11;
    ctx.beginPath();
    ctx.moveTo(-0.28, -0.36);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(pedalX, pedalY);
    ctx.stroke();

    ctx.fillStyle = '#ff7b1c';
    ctx.beginPath();
    ctx.moveTo(pedalX, pedalY);
    ctx.lineTo(pedalX + 0.24, pedalY + 0.06);
    ctx.lineTo(pedalX + 0.18, pedalY - 0.08);
    ctx.closePath();
    ctx.fill();

    // Pelican Wing
    const flapOffset = Math.sin(bike.wingFlapPhase) * (keys.boost || bike.inWaterTime > 0 ? 0.28 : 0.06);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.18, -0.62);
    ctx.quadraticCurveTo(0.15, -0.92 + flapOffset, 0.52, -0.62);
    ctx.quadraticCurveTo(0.12, -0.36 + flapOffset * 0.5, -0.25, -0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(-0.36, -0.48 + flapOffset * 0.4, 0.22, 0.09, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Flowing Red Stunt Scarf
    const scarfWave = Math.sin(runTime * 12) * 0.1;
    ctx.fillStyle = '#ff4757';
    ctx.beginPath();
    ctx.moveTo(0.05, -0.82);
    ctx.quadraticCurveTo(-0.45, -0.95 + scarfWave, -0.88, -0.78 - scarfWave);
    ctx.lineTo(-0.82, -0.64 - scarfWave);
    ctx.quadraticCurveTo(-0.4, -0.78 + scarfWave, 0.05, -0.72);
    ctx.closePath();
    ctx.fill();

    // Articulated S-Curved Pelican Neck & Head
    ctx.save();
    ctx.translate(0.04, -0.76);
    ctx.rotate(bike.neckBobAngle);

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 0.24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-0.18, -0.28, -0.05, -0.52);
    ctx.stroke();

    ctx.translate(-0.05, -0.56);

    // Expandable Orange Gular Throat Pouch
    const pouchSwell = 0.24 + bike.pouchFishCount * 0.045 + bike.beakOpen * 0.14;
    ctx.fillStyle = '#ff922b';
    ctx.strokeStyle = '#d9650f';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(0.08, -0.04);
    ctx.quadraticCurveTo(0.45, 0.42 + pouchSwell, 0.92, -0.06 + bike.beakOpen * 0.12);
    ctx.lineTo(0.08, -0.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (bike.beakOpen > 0.15) {
      ctx.fillStyle = '#ffd147';
      ctx.beginPath();
      ctx.moveTo(0.65, 0.02);
      ctx.lineTo(0.95, 0.16);
      ctx.lineTo(0.88, -0.05);
      ctx.closePath();
      ctx.fill();
    }

    // Upper Iconic Long Pelican Bill
    ctx.fillStyle = '#ffb82b';
    ctx.strokeStyle = '#e07a16';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(0.05, -0.14);
    ctx.lineTo(0.96, -0.12 - bike.beakOpen * 0.08);
    ctx.quadraticCurveTo(1.04, -0.04, 0.92, -0.02 - bike.beakOpen * 0.08);
    ctx.lineTo(0.05, -0.03);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Head Feathers
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-0.04, -0.06, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Motocross Helmet
    ctx.fillStyle = '#1e90ff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(-0.06, -0.1, 0.27, Math.PI * 0.85, Math.PI * 2.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Aviator Goggles & Eye
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(0.02, -0.22, 0.16, 0.13, 0.04);
    ctx.fill();
    ctx.fillStyle = '#38d9ff';
    ctx.beginPath();
    ctx.arc(0.11, -0.15, 0.045, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  function drawWheel(w) {
    const r = BASE_PARAMS.wheelRadius;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.rot);

    ctx.fillStyle = '#141b24';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.09;
    const knobs = 12;
    for (let i = 0; i < knobs; i++) {
      const a = (i * Math.PI * 2) / knobs;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 0.1), Math.sin(a) * (r - 0.1));
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.045;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * r * 0.7, -Math.sin(a) * r * 0.7);
      ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
      ctx.stroke();
    }

    ctx.fillStyle = '#ff8a2b';
    ctx.beginPath();
    ctx.arc(0, 0, 0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCoilSpring(x1, y1, x2, y2, coils, width, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    ctx.strokeStyle = color;
    ctx.lineWidth = 0.065;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const steps = coils * 2;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const side = i % 2 === 0 ? 1 : -1;
      const px = x1 + dx * t + nx * width * side;
      const py = y1 + dy * t + ny * width * side;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // ============================================================================
  // HUD & UI UPDATES
  // ============================================================================
  function formatTime(sec) {
    if (sec === undefined || sec === null) return '--:--.--';
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    const secs = Math.floor(rem);
    const hundredths = Math.floor((rem - secs) * 100);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(
      hundredths
    ).padStart(2, '0')}`;
  }

  function renderFishPips() {
    if (!elFishIconsRow) return;
    elFishIconsRow.innerHTML = '';
    for (let i = 0; i < fishItems.length; i++) {
      const caught = fishItems[i] && fishItems[i].collected;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 14');
      svg.setAttribute('class', `fish-pip ${caught ? 'caught' : ''}`);
      svg.innerHTML = `<path d="M2 7 L0 2 L5 5 Q13 0 22 7 Q13 14 5 9 L0 12 Z" fill="${
        caught ? '#ffd147' : '#98b3d1'
      }"/>`;
      elFishIconsRow.appendChild(svg);
    }
  }

  function buildCourseMiniSvg(lvl) {
    const pts = lvl.structures[0].points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(8, maxY - minY);
    const d = pts
      .filter((_, idx) => idx % 3 === 0 || idx === pts.length - 1)
      .map((p, idx) => {
        const x = ((p[0] - minX) / spanX) * 100;
        const y = 4 + ((p[1] - minY) / spanY) * 22;
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return `<svg class="course-mini-svg" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d="${d} L100,30 L0,30 Z" fill="${lvl.theme.groundFill}" opacity="0.85"/>
      <path d="${d}" fill="none" stroke="${lvl.theme.groundTop}" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }

  function renderWelcomeCourses() {
    const elStageNum = document.getElementById('welcomeStageNum');
    const elStageTitle = document.getElementById('welcomeStageTitle');
    if (elStageNum && currentLevel) {
      const bestStr = bestTimes[currentLevelIdx] ? ` • BEST ${formatTime(bestTimes[currentLevelIdx])}` : '';
      elStageNum.textContent = `STAGE ${currentLevelIdx + 1} OF ${LEVELS.length}${bestStr}`;
    }
    if (elStageTitle && currentLevel) {
      elStageTitle.textContent = currentLevel.name.replace(/^\d+\.\s*/, '');
    }
  }

  function updateHUD() {
    elLevelName.textContent = currentLevel.name;
    elFishCount.textContent = `${fishCollected}/${fishItems.length}`;
    if (fishCollected >= fishItems.length) {
      elFishPill.classList.add('ready');
    } else {
      elFishPill.classList.remove('ready');
    }

    elTimer.textContent = formatTime(runTime);
    elBestTime.textContent = formatTime(bestTimes[currentLevelIdx]);

    const speedKmh = Math.round(Math.hypot(bike.vx, bike.vy) * 3.6);
    elSpeedValue.textContent = speedKmh;

    if (bike.inWaterTime > 0) {
      elDriveState.textContent = 'FLOATING';
      elDriveState.style.color = '#38d9ff';
    } else if (keys.boost && bike.turboFuel > 0.05) {
      elDriveState.textContent = 'WING BOOST';
      elDriveState.style.color = '#ffd147';
    } else if (keys.throttle) {
      elDriveState.textContent = bike.momentumChain > 0.7 ? 'OVERDRIVE' : 'ACCEL';
      elDriveState.style.color = '#2ee889';
    } else if (keys.brake) {
      elDriveState.textContent = 'BRAKE';
      elDriveState.style.color = '#ff5468';
    } else {
      elDriveState.textContent = 'COAST';
      elDriveState.style.color = '#98b3d1';
    }

    const momPct = Math.round(bike.momentumChain * 100);
    elMomentumBar.style.width = `${momPct}%`;
    elAccelChainPct.textContent = `${momPct}%`;

    const boostPct = Math.round(bike.turboFuel * 100);
    elBoostBar.style.width = `${boostPct}%`;
    elBoostPct.textContent = `${boostPct}%`;

    // Auto-dim bottom-right key reminder while actively riding fast
    if (elHudControls) {
      elHudControls.style.opacity = speedKmh > 12 ? '0.28' : '0.88';
    }
  }

  function renderLevelGrid() {
    elLevelGrid.innerHTML = '';
    LEVELS.forEach((lvl, idx) => {
      const card = document.createElement('div');
      card.className = `level-card ${idx === currentLevelIdx ? 'active' : ''}`;
      card.innerHTML = `
        <div class="level-card-num">Course ${idx + 1}</div>
        <div class="level-card-title">${lvl.name}</div>
        ${buildCourseMiniSvg(lvl)}
        <div class="level-card-desc">${lvl.desc}</div>
        <div class="level-card-best">BEST: ${formatTime(bestTimes[idx])}</div>
      `;
      card.addEventListener('click', () => {
        elLevelModal.classList.add('hidden');
        startPlayingLevel(idx);
      });
      elLevelGrid.appendChild(card);
    });
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================
  window.addEventListener('keydown', (e) => {
    sound.init();
    const code = e.code;

    // If Welcome Screen is open, pressing Gas (W/Up) or Space/Enter launches immediately!
    if (isWelcomeOpen) {
      if (code === 'ArrowUp' || code === 'KeyW') {
        isWelcomeOpen = false;
        elWelcomeScreen.classList.add('hidden');
        elHudTop.classList.remove('hud-hidden');
        elHudTelemetry.classList.remove('hud-hidden');
        elTouchControls.classList.remove('hud-hidden');
        keys.brake = false;
        keys.throttle = true;
        e.preventDefault();
      } else if (code === 'Space' || code === 'Enter') {
        startPlayingLevel(currentLevelIdx);
        e.preventDefault();
      } else if (code === 'ArrowLeft' || code === 'KeyA') {
        loadLevel(currentLevelIdx - 1);
        e.preventDefault();
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        loadLevel(currentLevelIdx + 1);
        e.preventDefault();
      } else if (code >= 'Digit1' && code <= 'Digit6') {
        const idx = parseInt(code.replace('Digit', ''), 10) - 1;
        loadLevel(idx);
      }
      return;
    }

    if (code === 'Escape') {
      openWelcomeScreen();
      e.preventDefault();
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      keys.throttle = true;
      e.preventDefault();
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      keys.brake = true;
      e.preventDefault();
    } else if (code === 'ArrowLeft' || code === 'KeyA') {
      keys.leanLeft = true;
      e.preventDefault();
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      keys.leanRight = true;
      e.preventDefault();
    } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
      keys.boost = true;
      e.preventDefault();
    } else if (code === 'KeyE' || code === 'KeyC') {
      keys.hop = true;
      triggerHop();
      e.preventDefault();
    } else if (code === 'Space') {
      if (!e.repeat) flipDirection();
      e.preventDefault();
    } else if (code === 'KeyR' || code === 'Backspace') {
      loadLevel(currentLevelIdx);
      e.preventDefault();
    } else if (code === 'Enter') {
      if (runStatus === 'won') {
        loadLevel(currentLevelIdx + 1);
      } else if (runStatus === 'crashed') {
        loadLevel(currentLevelIdx);
      }
    } else if (code === 'KeyL') {
      elLevelModal.classList.toggle('hidden');
    } else if (code === 'KeyP') {
      elPhysicsDrawer.classList.toggle('hidden');
    } else if (code === 'KeyG') {
      toggleGhost();
    } else if (code === 'KeyH') {
      toggleHeadCrash();
    } else if (code === 'KeyM') {
      toggleSound();
    } else if (code >= 'Digit1' && code <= 'Digit6') {
      const idx = parseInt(code.replace('Digit', ''), 10) - 1;
      loadLevel(idx);
    }
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code === 'ArrowUp' || code === 'KeyW') keys.throttle = false;
    else if (code === 'ArrowDown' || code === 'KeyS') keys.brake = false;
    else if (code === 'ArrowLeft' || code === 'KeyA') keys.leanLeft = false;
    else if (code === 'ArrowRight' || code === 'KeyD') keys.leanRight = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') keys.boost = false;
    else if (code === 'KeyE' || code === 'KeyC') keys.hop = false;
  });

  document.querySelectorAll('.touch-btn').forEach((btn) => {
    const action = btn.dataset.action;
    const setHold = (active) => {
      btn.classList.toggle('pressed', active);
      if (action === 'throttle') keys.throttle = active;
      else if (action === 'brake') keys.brake = active;
      else if (action === 'leanLeft') keys.leanLeft = active;
      else if (action === 'leanRight') keys.leanRight = active;
      else if (action === 'boost') keys.boost = active;
      else if (action === 'hop' && active) triggerHop();
      else if (action === 'turn' && active) flipDirection();
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.init();
      setHold(true);
    });
    btn.addEventListener('pointerup', () => setHold(false));
    btn.addEventListener('pointerleave', () => setHold(false));
  });

  // Welcome Screen & HUD Buttons
  const on = (id, evt, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
    return el;
  };

  on('btnStartGame', 'click', () => {
    sound.init();
    startPlayingLevel(currentLevelIdx);
  });

  on('btnPrevStage', 'click', () => {
    sound.init();
    loadLevel(currentLevelIdx - 1);
  });

  on('btnNextStage', 'click', () => {
    sound.init();
    loadLevel(currentLevelIdx + 1);
  });

  on('btnOpenCoursesFromPicker', 'click', () => {
    renderLevelGrid();
    elLevelModal.classList.remove('hidden');
  });

  on('btnMenuHome', 'click', () => {
    openWelcomeScreen();
  });

  on('btnRestartQuick', 'click', () => {
    loadLevel(currentLevelIdx);
  });

  on('btnLevelSelect', 'click', () => {
    renderLevelGrid();
    elLevelModal.classList.toggle('hidden');
  });

  on('btnCloseLevels', 'click', () => {
    elLevelModal.classList.add('hidden');
  });

  const btnHelmetMode = document.getElementById('btnHelmetMode');
  const btnSoundToggle = document.getElementById('btnSoundToggle');

  function toggleGhost() {
    ghostEnabled = !ghostEnabled;
  }

  function toggleHeadCrash() {
    headCrashEnabled = !headCrashEnabled;
    if (btnHelmetMode) {
      btnHelmetMode.classList.toggle('active', !headCrashEnabled);
    }
    showStuntToast(
      headCrashEnabled ? 'HELMET CRASH: CLASSIC ELMA' : 'HELMET CRASH: SAFE MODE',
      '#5ce6ff'
    );
  }
  if (btnHelmetMode) btnHelmetMode.addEventListener('click', toggleHeadCrash);

  function toggleSound() {
    sound.enabled = !sound.enabled;
    if (btnSoundToggle) {
      btnSoundToggle.classList.toggle('active', sound.enabled);
    }
  }
  if (btnSoundToggle) btnSoundToggle.addEventListener('click', toggleSound);

  on('btnOverlayMenu', 'click', () => {
    openWelcomeScreen();
  });
  on('btnOverlayRetry', 'click', () => {
    loadLevel(currentLevelIdx);
  });
  on('btnOverlayNext', 'click', () => {
    if (runStatus === 'won') loadLevel(currentLevelIdx + 1);
    else loadLevel(currentLevelIdx);
  });

  // Sync default slider values to balanced 1.0x settings
  document.getElementById('sliderTorque').value = '1.00';
  document.getElementById('sliderTopSpeed').value = '1.00';
  document.getElementById('sliderSpring').value = '1.00';
  document.getElementById('sliderRebound').value = '1.10';
  document.getElementById('sliderPitch').value = '1.05';
  document.getElementById('sliderGravity').value = '1.00';

  const bindSlider = (sliderId, valId, key) => {
    const slider = document.getElementById(sliderId);
    const valSpan = document.getElementById(valId);
    const sync = () => {
      tuning[key] = parseFloat(slider.value);
      valSpan.textContent = `${tuning[key].toFixed(2)}x`;
    };
    slider.addEventListener('input', sync);
    sync();
    return { slider, sync };
  };

  const sliders = [
    bindSlider('sliderTorque', 'valTorque', 'torque'),
    bindSlider('sliderTopSpeed', 'valTopSpeed', 'topSpeed'),
    bindSlider('sliderSpring', 'valSpring', 'spring'),
    bindSlider('sliderRebound', 'valRebound', 'rebound'),
    bindSlider('sliderPitch', 'valPitch', 'pitch'),
    bindSlider('sliderGravity', 'valGravity', 'gravity'),
  ];

  document.getElementById('btnResetPhysics').addEventListener('click', () => {
    document.getElementById('sliderTorque').value = '1.00';
    document.getElementById('sliderTopSpeed').value = '1.00';
    document.getElementById('sliderSpring').value = '1.00';
    document.getElementById('sliderRebound').value = '1.10';
    document.getElementById('sliderPitch').value = '1.05';
    document.getElementById('sliderGravity').value = '1.00';
    sliders.forEach((s) => s.sync());
  });

  window.__pelicoMania = {
    get bike() {
      return bike;
    },
    get currentLevelIdx() {
      return currentLevelIdx;
    },
    loadLevel,
    startPlayingLevel,
    openWelcomeScreen,
    triggerHop,
    flipDirection,
    rescueToLastSafeSpot,
  };

  // ============================================================================
  // MAIN GAME LOOP
  // ============================================================================
  loadLevel(0);

  let lastTimestamp = performance.now();
  function loop(now) {
    const rawDt = (now - lastTimestamp) / 1000;
    lastTimestamp = now;
    const dt = Math.min(0.033, Math.max(0.001, rawDt));

    stepPhysics(dt);
    updateCamera(dt);
    render();
    updateHUD();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
