import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

import { PHYSICS, ARENA, RAGDOLL, DEBUG, SPAWN, AI } from './src/config.js';

// Game constants from config
const TICK_RATE = PHYSICS.TICK_RATE;
const ACCELERATION = PHYSICS.ACCELERATION;
const MAX_SPEED = PHYSICS.MAX_SPEED;
const TURN_ACCELERATION = PHYSICS.TURN_ACCELERATION;
const ANGULAR_FRICTION = PHYSICS.ANGULAR_FRICTION;
const FRICTION = PHYSICS.FRICTION;
const SIDEWAYS_FRICTION_MULTIPLIER = PHYSICS.SIDEWAYS_FRICTION_MULTIPLIER;
const MASS = PHYSICS.MASS;
const ELASTICITY = PHYSICS.COLLISION_ELASTICITY;
const COLLISION_TILT_MULTIPLIER = PHYSICS.COLLISION_TILT_MULTIPLIER;
const TILT_RECOVERY_DAMPING = PHYSICS.TILT_RECOVERY_DAMPING;
const GRAVITY = PHYSICS.GRAVITY;
const FENCE_RADIUS = ARENA.COLLISION_RADIUS;

const toRadians = deg => deg * Math.PI / 180;
const TILT_DEATH_RAD = toRadians(RAGDOLL.TILT_DEATH_DEGREES);
const SHEEP_RADIUS = 0.7; // Approximate collision radius
const GROUND_Y = 0.6; // Ground level

// Helper function for linear interpolation
function lerp(a, b, t) { return a + (b - a) * t; }

// Player states: { [id]: { position, spawn, rotation, angularVelocity, velocityX, velocityY, velocityZ, isDead, respawnTimer, rotationX, rotationZ, angularVelocityX, angularVelocityZ, personality?, isAI?, aiTimer?, aiTargetAngle?, aiAvoidTimer?, scaredTimer? } }
const players = {};

// Input states: { [id]: { w, a, s, d } }
const inputStates = {};

const RESPAWN_TIME = 3; // seconds

function getRandomSpawn() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN.RADIUS;
    return {
        x: Math.cos(angle) * radius,
        y: GROUND_Y, // Set ground Y level directly
        z: Math.sin(angle) * radius
    };
}

// --- AI Sheep Setup ---
const AI_SHEEP_COUNT = AI.COUNT;
const aiSheepIds = [];
const AI_PERSONALITIES = [
    'timid',
    'brave',
    'curious',
    'hyper',
    'aggressive'
];
function createAISheep(id, personality) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (SPAWN.RADIUS * 0.7);
    return {
        position: {
            x: Math.cos(angle) * radius,
            y: GROUND_Y,
            z: Math.sin(angle) * radius
        },
        spawn: null, // Not used for AI
        rotation: Math.random() * Math.PI * 2, // Yaw
        angularVelocity: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        isDead: false,
        respawnTimer: 0,
        rotationX: 0, // Tilt
        rotationZ: 0, // Tilt
        angularVelocityX: 0,
        angularVelocityZ: 0,
        isAI: true,
        aiTimer: 0, // Timer for changing behavior/target
        aiTargetAngle: Math.random() * Math.PI * 2, // Current target direction
        aiAvoidTimer: 0, // Timer for avoidance maneuvers
        personality,
        scaredTimer: 0 // Timer for timid sheep scare reaction
    };
}
for (let i = 0; i < AI_SHEEP_COUNT; i++) {
    const id = `ai-sheep-${i}`;
    aiSheepIds.push(id);
    // Assign personalities, cycling through the list
    players[id] = createAISheep(id, AI_PERSONALITIES[i % AI_PERSONALITIES.length]);
}

// Game loop
setInterval(() => {
    // Update player physics and handle inputs
    for (const id in players) {
        const player = players[id];
        if (player.isDead) {
            player.respawnTimer -= 1 / TICK_RATE;
            if (player.respawnTimer <= 0) {
                // Respawn logic
                if (DEBUG.RESPAWN_AT_SPAWN && player.spawn) {
                    player.position = { ...player.spawn, y: GROUND_Y };
                } else {
                    player.position = getRandomSpawn();
                }
                // Reset physics state
                player.rotation = Math.random() * Math.PI * 2;
                player.angularVelocity = 0;
                player.velocityX = 0;
                player.velocityY = 0;
                player.velocityZ = 0;
                player.rotationX = 0;
                player.rotationZ = 0;
                player.angularVelocityX = 0;
                player.angularVelocityZ = 0;
                player.isDead = false;
            }
            continue; // Skip physics update for dead players
        }

        // Get input or default if AI/missing
        const input = inputStates[id] || { w: false, a: false, s: false, d: false };

        // Apply turning acceleration (Yaw)
        let turnDir = 1;
        if (input.s && !input.w) turnDir = -1; // Reverse turning direction when moving backward
        if (input.a) player.angularVelocity += TURN_ACCELERATION * turnDir;
        if (input.d) player.angularVelocity -= TURN_ACCELERATION * turnDir;

        // Apply angular friction (Yaw)
        player.angularVelocity *= ANGULAR_FRICTION;

        // Update Yaw rotation
        player.rotation += player.angularVelocity;

        // Apply forward/backward acceleration based on Yaw rotation
        let accX = 0;
        let accZ = 0;
        if (input.w) {
            accX += Math.sin(player.rotation) * ACCELERATION;
            accZ += Math.cos(player.rotation) * ACCELERATION;
        }
        if (input.s) {
            accX -= Math.sin(player.rotation) * ACCELERATION * 0.5; // Slower reverse
            accZ -= Math.cos(player.rotation) * ACCELERATION * 0.5;
        }
        player.velocityX += accX;
        player.velocityZ += accZ;

        // Apply car-like friction (higher sideways friction)
        const forwardX = Math.sin(player.rotation);
        const forwardZ = Math.cos(player.rotation);
        const rightX = Math.cos(player.rotation);
        const rightZ = -Math.sin(player.rotation);

        const forwardSpeed = player.velocityX * forwardX + player.velocityZ * forwardZ;
        const sidewaysSpeed = player.velocityX * rightX + player.velocityZ * rightZ;

        const newForwardSpeed = forwardSpeed * FRICTION;
        const newSidewaysSpeed = sidewaysSpeed * (1 - (1 - FRICTION) * SIDEWAYS_FRICTION_MULTIPLIER);

        // Reconstruct velocity vector from forward and sideways components
        player.velocityX = forwardX * newForwardSpeed + rightX * newSidewaysSpeed;
        player.velocityZ = forwardZ * newForwardSpeed + rightZ * newSidewaysSpeed;

        // Clamp speed to MAX_SPEED
        const speed = Math.sqrt(player.velocityX**2 + player.velocityZ**2);
        if (speed > MAX_SPEED) {
            const factor = MAX_SPEED / speed;
            player.velocityX *= factor;
            player.velocityZ *= factor;
        }
        if (speed < 0.01) { // Prevent drifting at very low speeds
             player.velocityX = 0;
             player.velocityZ = 0;
        }

        // Apply gravity
        player.velocityY -= GRAVITY / TICK_RATE;

        // Update position
        player.position.x += player.velocityX;
        player.position.y += player.velocityY;
        player.position.z += player.velocityZ;

        // Stop horizontal movement for scared jumping timid sheep
        if (player.personality === 'timid' && player.scaredTimer > 0 && player.position.y > GROUND_Y) {
            player.velocityX = 0;
            player.velocityZ = 0;
            // Add rapid backflip angular velocity while jumping
            player.angularVelocityX = -0.7; // Negative = backflip
        }

        // Ground constraint
        if (player.position.y < GROUND_Y) {
            player.position.y = GROUND_Y;
            player.velocityY = 0;
            // Apply ground friction to tilt angular velocities
            player.angularVelocityX = (player.angularVelocityX || 0) * 0.9;
            player.angularVelocityZ = (player.angularVelocityZ || 0) * 0.9;
        }

        // Update Tilt Rotation (X and Z axes)
        player.rotationX = (player.rotationX || 0) + (player.angularVelocityX || 0);
        player.rotationZ = (player.rotationZ || 0) + (player.angularVelocityZ || 0);

        // Apply restorative force to tilt (pull back toward zero)
        player.angularVelocityX = (player.angularVelocityX || 0) - (player.rotationX || 0) * PHYSICS.TILT_RECOVERY_FORCE;
        player.angularVelocityZ = (player.angularVelocityZ || 0) - (player.rotationZ || 0) * PHYSICS.TILT_RECOVERY_FORCE;

        // Apply damping to tilt angular velocity
        player.angularVelocityX = (player.angularVelocityX || 0) * TILT_RECOVERY_DAMPING;
        player.angularVelocityZ = (player.angularVelocityZ || 0) * TILT_RECOVERY_DAMPING;

        // Snap small tilt angular velocities to zero
        if (Math.abs(player.angularVelocityX || 0) < 0.001) player.angularVelocityX = 0;
        if (Math.abs(player.angularVelocityZ || 0) < 0.001) player.angularVelocityZ = 0;

        // Apply Z-tilt based on turning (yaw angular velocity) - smoothly interpolate
        // Adds visual effect of leaning into turns
        const targetTurningTiltZ = -player.angularVelocity * 5;
        player.rotationZ = player.rotationZ * 0.95 + targetTurningTiltZ * 0.05;

        // Snap small total Z rotation to zero if not turning and collision tilt is small
        if (Math.abs(player.rotationZ || 0) < 0.01 && Math.abs(player.angularVelocity) < 0.01 && Math.abs(player.angularVelocityZ || 0) < 0.01) {
             player.rotationZ = 0;
        }
        // Snap small total X rotation to zero if collision tilt is small
        if (Math.abs(player.rotationX || 0) < 0.01 && Math.abs(player.angularVelocityX || 0) < 0.01) {
            player.rotationX = 0;
        }

        // Check fence collision (death condition)
        const distanceFromCenter = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
        if (distanceFromCenter >= FENCE_RADIUS) {
             if (!player.isDead) {
                 player.isDead = true;
                 player.respawnTimer = RESPAWN_TIME;
                 broadcast({ type: 'death', id, position: player.position });
            }
        }
        // Check tilt death ONLY when on ground AND not a recently scared timid sheep
        if (player.position.y <= GROUND_Y + 0.001) {
            const isRecentlyScaredTimid = player.personality === 'timid' && player.scaredTimer > 0;
            if (!isRecentlyScaredTimid && (Math.abs(player.rotationZ || 0) > TILT_DEATH_RAD || Math.abs(player.rotationX || 0) > TILT_DEATH_RAD) && !player.isDead) {
                player.isDead = true;
                player.respawnTimer = RESPAWN_TIME;
                broadcast({ type: 'death', id, position: player.position });
            }
        }
    }

    // --- AI Sheep Logic ---
    for (const id of aiSheepIds) {
        const sheep = players[id];
        if (!sheep || sheep.isDead) continue;

        const p = sheep.personality;

        // Timid: Handle scare timer and fence avoidance while scared
        if (p === 'timid' && sheep.scaredTimer > 0) {
            sheep.scaredTimer -= 1 / TICK_RATE;
            // Add fence avoidance while scared
            const dist = Math.sqrt(sheep.position.x ** 2 + sheep.position.z ** 2);
            const FENCE_AVOID_THRESHOLD = 0.9;
            if (dist > FENCE_RADIUS * FENCE_AVOID_THRESHOLD) {
                const angleToCenter = Math.atan2(-sheep.position.x, -sheep.position.z);
                sheep.aiTargetAngle = angleToCenter + (Math.random() - 0.5) * 0.4; // Turn away
                sheep.aiTimer = 0.1; // Re-evaluate quickly
            }
        }
        // Brave: Sometimes ignores fence
        else if (p === 'brave') {
            if (Math.random() < 0.8) { // 80% chance to avoid fence
                const dist = Math.sqrt(sheep.position.x ** 2 + sheep.position.z ** 2);
                if (dist > FENCE_RADIUS * 0.9) {
                    const angleToCenter = Math.atan2(-sheep.position.x, -sheep.position.z);
                    sheep.aiTargetAngle = angleToCenter + (Math.random() - 0.5) * 0.4;
                }
            }
            // 20% chance to ignore fence
        }
        // Curious: Occasionally heads toward other sheep
        else if (p === 'curious') {
            if (Math.random() < 0.01) { // Low chance each tick
                let closestDist = Infinity;
                let targetAngle = null;
                for (const otherId in players) {
                    if (otherId === id || !players[otherId] || players[otherId].isDead) continue;
                    const other = players[otherId];
                    const dx = other.position.x - sheep.position.x;
                    const dz = other.position.z - sheep.position.z;
                    const d = Math.sqrt(dx*dx + dz*dz);
                    if (d < closestDist) {
                        closestDist = d;
                        targetAngle = Math.atan2(dx, dz);
                    }
                }
                if (targetAngle !== null) {
                    sheep.aiTargetAngle = targetAngle + (Math.random() - 0.5) * 0.3;
                }
            }
        }
        // Hyper: Changes direction often
        else if (p === 'hyper') {
            if (sheep.aiTimer <= 0) {
                sheep.aiTimer = 0.5 + Math.random() * 0.5; // Short timer
            }
        }
        // Aggressive: Seeks out and chases the nearest sheep
        else if (p === 'aggressive') {
            let closestDist = Infinity;
            let targetAngle = null;
            for (const otherId in players) {
                if (otherId === id || !players[otherId] || players[otherId].isDead) continue;
                const other = players[otherId];
                const dx = other.position.x - sheep.position.x;
                const dz = other.position.z - sheep.position.z;
                const d = Math.sqrt(dx*dx + dz*dz);
                if (d < closestDist) {
                    closestDist = d;
                    targetAngle = Math.atan2(dx, dz);
                }
            }
            if (targetAngle !== null) {
                sheep.aiTargetAngle = targetAngle + (Math.random() - 0.5) * 0.2; // Slight randomness in chase
            }
        }

        // Default AI behavior: Random walk timer
        sheep.aiTimer = (sheep.aiTimer || 0) - 1 / TICK_RATE;
        if (sheep.aiTimer <= 0 && (!['timid'].includes(p) || sheep.aiAvoidTimer <= 0)) {
            sheep.aiTargetAngle = Math.random() * Math.PI * 2;
            // Set timer based on personality (hyper changes often)
            if (p === 'hyper') sheep.aiTimer = 0.5 + Math.random() * 0.5;
            else sheep.aiTimer = 2 + Math.random() * 3; // Default timer
        }

        // AI Movement: Turn toward target angle and move forward
        let angleDiff = sheep.aiTargetAngle - sheep.rotation;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff)); // Normalize angle difference

        // Personality-based movement speeds
        let turnSpeed = 0.07;
        let moveSpeed = 0.7;
        if (p === 'timid') { turnSpeed = 0.09; moveSpeed = 0.6; }
        if (p === 'brave') { turnSpeed = 0.05; moveSpeed = 0.8; }
        if (p === 'curious') { turnSpeed = 0.07; moveSpeed = 0.7; }
        if (p === 'hyper') { turnSpeed = 0.13; moveSpeed = 1.1; }

        sheep.angularVelocity = angleDiff * turnSpeed;
        sheep.rotation += sheep.angularVelocity;

        // Apply forward acceleration (scaled by moveSpeed)
        sheep.velocityX += Math.sin(sheep.rotation) * ACCELERATION * moveSpeed;
        sheep.velocityZ += Math.cos(sheep.rotation) * ACCELERATION * moveSpeed;
    }

    // Broadcast game state to all clients
    const playerStates = Object.entries(players).map(([id, player]) => ({
        id,
        position: player.position,
        // Send full rotation state (X, Y, Z)
        rotation: { x: player.rotationX || 0, y: player.rotation || 0, z: player.rotationZ || 0 },
        isDead: player.isDead,
        personality: player.personality // Include personality for client-side visuals
    }));
    broadcast({ type: 'state', players: playerStates });

}, 1000 / TICK_RATE);

// Broadcast message to all connected clients
function broadcast(message) {
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    const id = uuidv4();
    console.log('Client connected:', id);
    const spawnPos = getRandomSpawn();
    // Initialize new player state
    players[id] = {
        position: { ...spawnPos },
        spawn: { ...spawnPos }, // Store initial spawn point
        rotation: Math.random() * Math.PI * 2, // Yaw
        angularVelocity: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        isDead: false,
        respawnTimer: 0,
        rotationX: 0, // Tilt
        rotationZ: 0, // Tilt
        angularVelocityX: 0,
        angularVelocityZ: 0
    };
    inputStates[id] = { w: false, a: false, s: false, d: false };

    // Send initialization data to the newly connected client
    ws.send(JSON.stringify({
        type: 'init',
        id,
        initialPlayerState: { ...players[id], personality: players[id].personality } // Send full initial state
    }));

    // Inform other clients about the new player connection
    const connectMessage = JSON.stringify({
        type: 'connect',
        player: {
            id,
            position: players[id].position,
            rotation: { x: 0, y: players[id].rotation, z: 0 }, // Initial rotation state
            isDead: false,
            personality: players[id].personality
        }
    });
    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(connectMessage);
        }
    });

    // Handle messages received from the client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Update input state if player exists and message is valid
            if (data.type === 'input' && inputStates[id]) {
                if (typeof data.key === 'string' && typeof data.pressed === 'boolean' && inputStates[id].hasOwnProperty(data.key)) {
                    inputStates[id][data.key] = data.pressed;
                } else {
                    console.warn(`Received invalid input message format for player ${id}:`, data);
                }
            }
        } catch (e) {
            console.error("Failed to parse message or invalid message format: ", message.toString(), e); // Log message content as string
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log('Client disconnected:', id);
        delete players[id];
        delete inputStates[id];
        // Inform remaining clients about the disconnection
        broadcast({ type: 'disconnect', id });
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
        console.error('WebSocket error for client:', id, error);
        // Clean up player state on error as well
        delete players[id];
        delete inputStates[id];
        broadcast({ type: 'disconnect', id });
    });
});

// Serve static files (HTML, CSS, client-side JS)
app.use(express.static(path.join(__dirname)));

// Start the HTTP server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`); // Log accessible URL
});