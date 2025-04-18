// Game physics
export const PHYSICS = {
    TICK_RATE: 60,
    ACCELERATION: 0.05,
    MAX_SPEED: 1.5,
    TURN_ACCELERATION: 0.015, // How quickly rotation starts/stops
    ANGULAR_FRICTION: 0.75, // Damping for rotation
    FRICTION: 0.95, // Damping for forward/backward movement
    SIDEWAYS_FRICTION_MULTIPLIER: 3.0, // Higher friction for sideways movement (car-like)
    MASS: 1.0, // Affects collision response
    COLLISION_ELASTICITY: 0.05, // How bouncy collisions are (0 = no bounce, 1 = fully elastic)
    COLLISION_TILT_MULTIPLIER: 0.8, // How much collisions cause tilt
    TILT_RECOVERY_DAMPING: 0.95, // Damping for tilt recovery speed
    TILT_RECOVERY_FORCE: 0.01, // Force pulling tilt back to zero
    GRAVITY: 1, // Downward acceleration

    // Sensitivity factors for collision tilt based on impact angle (0 = front/back, PI/2 = side)
    COLLISION_SENSITIVITY_FRONT: 0.3, // Less tilt from head-on/rear impacts
    COLLISION_SENSITIVITY_SIDE: 1.0, // Full tilt from side impacts
};

// Arena settings
export const ARENA = {
    COLLISION_RADIUS: 100, // Physics boundary radius
    VISUAL_RADIUS_OFFSET: 1,  // Visual fence distance beyond collision radius
    FENCE_SEGMENTS: 32, // Number of fence posts/sections
    FENCE_HEIGHT: 1.5,
    GROUND_EXTRA_RADIUS: 60 // How much the ground extends beyond the visual fence
};

// Camera settings
export const CAMERA = {
    FOV: 90, // Field of View
    NEAR: 0.1, // Near clipping plane
    FAR: 1000, // Far clipping plane
    DISTANCE: 2, // Distance from player
    HEIGHT: 1 // Height relative to player
};

// Visual settings
export const VISUALS = {
    GROUND_COLOR: 0x3a7d44,
    FENCE_COLOR: 0x8b4513,
    FENCE_POST_RADIUS: 0.35,
    FENCE_RAIL_RADIUS: 0.18,
    SHEEP_COLOR: 0xFFFFFF, // Default body color
    SHEEP_HEAD_COLOR: 0xF5F5F5,
    SHEEP_EYE_COLOR: 0x000000,
    SHEEP_LEGS_COLOR: 0x333333,
    SHEEP_BODY_RADIUS: 0.5,
    SHEEP_BODY_LENGTH: 1,
    SHEEP_HEAD_RADIUS: 0.5,
    SHEEP_LEG_RADIUS: 0.1,
    SHEEP_LEG_LENGTH: .5,
    // Body colors based on AI personality
    SHEEP_PERSONALITY_COLORS: {
        timid:      0xB0E0E6, // Pale blue
        brave:      0xFFD700, // Gold
        curious:    0xADFF2F, // Green-yellow
        hyper:      0xFF69B4, // Hot pink
        aggressive: 0xFF6347  // Tomato red
    }
};

// Lighting settings
export const LIGHTING = {
    AMBIENT_INTENSITY: 0.5,
    DIRECTIONAL_INTENSITY: 0.8,
    DIRECTIONAL_POSITION: [50, 50, 50] // Light direction from this position towards origin
};

// Explosion settings (visual effect on death)
export const EXPLOSION = {
    SPRITESHEET: './src/assets/explosion-sheet.png',
    SPRITESHEET_FRAMES: 17, // Total frames in the sheet
    SPRITESHEET_ROWS: 1,
    SPRITESHEET_COLS: 17,
    SIZE: 10, // Visual size multiplier (based on sheep body radius)
    DURATION_FRAMES: 120,  // How long the animation lasts (in game ticks)
    SOUND_PATH: './src/assets/explosion.mp3',
    SOUND_PITCH: 1.0, // Playback speed (1.0 = normal)
    SOUND_VOLUME: 0.5, // Base volume (0.0 to 1.0)
    PROXIMITY_SENSITIVITY: 1.0 // How far the sound travels (1.0 = full arena radius)
};

// Ragdoll/tilt settings
export const RAGDOLL = {
    TILT_DEATH_DEGREES: 60 // Max tilt angle before death
};

// Debug and spawn settings
export const DEBUG = {
    RESPAWN_AT_SPAWN: true // If true, players respawn at their initial spawn point
};

export const SPAWN = {
    RADIUS: 50 // Max distance from center for random spawn locations
};

// Post-processing settings
export const POST_PROCESSING = {
    PIXELATION_LEVEL: 6 // Pixel size (lower = more pixelated)
};

// Background music settings
export const MUSIC = {
    PATH: './src/assets/bg-music1.mp3',
    VOLUME: 0.1 // Volume (0.0 to 1.0)
};

// AI settings
export const AI = {
    COUNT: 0, // Number of AI-controlled sheep
};
