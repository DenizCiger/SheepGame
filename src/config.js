// Game physics
export const PHYSICS = {
    TICK_RATE: 60,
    ACCELERATION: 0.05,
    MAX_SPEED: 1.5,
    TURN_ACCELERATION: 0.015, // Increased turn acceleration for faster rotation start
    ANGULAR_FRICTION: 0.75,
    FRICTION: 0.95,
    SIDEWAYS_FRICTION_MULTIPLIER: 3.0,
    MASS: 1.0,
    COLLISION_ELASTICITY: 0.05,
    COLLISION_TILT_MULTIPLIER: 0.8, // Reduced tilt intensity
    TILT_RECOVERY_DAMPING: 0.95, // Increased damping significantly for more persistent recovery
    TILT_RECOVERY_FORCE: 0.01, // New: restorative force to return tilt to zero
    GRAVITY: 1, // Added gravity constant

    // Sensitivity factors for collision tilt (front = head, side = 90 deg)
    COLLISION_SENSITIVITY_FRONT: 0.3, // Less tilt when hit at the head
    COLLISION_SENSITIVITY_SIDE: 1.0, // Full tilt when hit at the side
}; 

// Arena settings
export const ARENA = {
    COLLISION_RADIUS: 100,
    VISUAL_RADIUS_OFFSET: 1,  // Visual fence will be this much larger than collision radius
    FENCE_SEGMENTS: 32,
    FENCE_HEIGHT: 1.5,
    GROUND_EXTRA_RADIUS: 60 // New: extra radius for ground beyond fence
};

// Camera settings
export const CAMERA = {
    FOV: 90,
    NEAR: 0.1,
    FAR: 1000,
    DISTANCE: 2,
    HEIGHT: 1 // Lowered camera height
};

// Visual settings
export const VISUALS = {
    GROUND_COLOR: 0x3a7d44,
    FENCE_COLOR: 0x8b4513,
    FENCE_POST_RADIUS: 0.35, // Thicker posts for visibility
    FENCE_RAIL_RADIUS: 0.18, // Thicker rails for visibility
    SHEEP_COLOR: 0xFFFFFF,
    SHEEP_HEAD_COLOR: 0xF5F5F5, // Slightly different head color
    SHEEP_EYE_COLOR: 0x000000, // Black eyes
    SHEEP_LEGS_COLOR: 0x333333,
    SHEEP_BODY_RADIUS: 0.5,
    SHEEP_BODY_LENGTH: 1,
    SHEEP_HEAD_RADIUS: 0.5,
    SHEEP_LEG_RADIUS: 0.1,
    SHEEP_LEG_LENGTH: .5,
    // Add per-personality colors
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
    DIRECTIONAL_POSITION: [50, 50, 50]
};

// Explosion settings
export const EXPLOSION = {
    SPRITESHEET: './src/assets/explosion-sheet.png',
    SPRITESHEET_FRAMES: 17,
    SPRITESHEET_ROWS: 1,
    SPRITESHEET_COLS: 17,
    SIZE: 10, // Multiplier for sheep body radius
    DURATION_FRAMES: 120,  // 2 seconds at 60fps
    SOUND_PATH: './src/assets/explosion.mp3',
    SOUND_PITCH: 1.0, // 1.0 = normal, <1 = lower, >1 = higher
    SOUND_VOLUME: 0.5, // 0.0 to 1.0
    PROXIMITY_SENSITIVITY: 1.0 // 1.0 = full arena, 0.5 = half arena, etc.
};

// Ragdoll/tilt settings
export const RAGDOLL = {
    TILT_DEATH_DEGREES: 60 // Increased death angle (harder to die from tilt)
};

// Debug and spawn settings
export const DEBUG = {
    RESPAWN_AT_SPAWN: true // If true, respawn at original spawn location
};

export const SPAWN = {
    RADIUS: 50 // Players spawn randomly within this radius from center
};

// Post-processing settings
export const POST_PROCESSING = {
    PIXELATION_LEVEL: 6 // Lower value = more pixelated. Adjust as needed.
};

export const MUSIC = {
    PATH: './src/assets/bg-music1.mp3',
    VOLUME: 0.1 // 0.0 to 1.0
};

// AI settings
export const AI = {
    COUNT: 50, // Number of AI sheep to spawn
};
