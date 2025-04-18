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
const SHEEP_RADIUS = 0.7; // Approximate collision radius for sheep
const GROUND_Y = 0.6; // Define ground level based on spawn height

// Helper function for linear interpolation
function lerp(a, b, t) { return a + (b - a) * t; }

// Player states: { [id]: { position, spawn, rotation, angularVelocity, velocityX, velocityY, velocityZ, isDead, respawnTimer, rotationX, rotationZ, angularVelocityX, angularVelocityZ } }
const players = {};

// Input states: { [id]: { w, a, s, d } }
const inputStates = {};

const RESPAWN_TIME = 3; // seconds

function getRandomSpawn() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN.RADIUS;
    return {
        x: Math.cos(angle) * radius,
        y: 0.6,
        z: Math.sin(angle) * radius
    };
}

// --- AI Sheep Setup ---
const AI_SHEEP_COUNT = AI.COUNT;
const aiSheepIds = [];
const AI_PERSONALITIES = [
    'timid',    // Avoids fence and other sheep a lot
    'brave',    // Sometimes doesn't notice the fence, but usually avoids it
    'curious',  // Occasionally heads toward other sheep
    'hyper',    // Moves fast, changes direction often
    'aggressive'// Seeks out other sheep and chases them
];
function createAISheep(id, personality) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (SPAWN.RADIUS * 0.7);
    return {
        position: {
            x: Math.cos(angle) * radius,
            y: 0.6,
            z: Math.sin(angle) * radius
        },
        spawn: null, // Not used for AI
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        isDead: false,
        respawnTimer: 0,
        rotationX: 0,
        rotationZ: 0,
        angularVelocityX: 0,
        angularVelocityZ: 0,
        isAI: true,
        aiTimer: 0,
        aiTargetAngle: Math.random() * Math.PI * 2,
        aiAvoidTimer: 0,
        personality,
        scaredTimer: 0 // For timid sheep scare reaction
    };
}
for (let i = 0; i < AI_SHEEP_COUNT; i++) {
    const id = `ai-sheep-${i}`;
    aiSheepIds.push(id);
    // Assign a different personality to each, cycling if more than 6
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
                if (DEBUG.RESPAWN_AT_SPAWN && player.spawn) {
                    player.position = { ...player.spawn, y: GROUND_Y }; // Ensure y is reset
                } else {
                    player.position = getRandomSpawn(); // y is set in getRandomSpawn
                }
                player.rotation = Math.random() * Math.PI * 2; // Reset Yaw rotation
                player.angularVelocity = 0; // Reset Yaw angular velocity
                player.velocityX = 0;
                player.velocityY = 0; // Reset vertical velocity
                player.velocityZ = 0;
                player.rotationX = 0; // Reset X tilt
                player.rotationZ = 0; // Reset Z tilt
                player.angularVelocityX = 0; // Reset X tilt angular velocity
                player.angularVelocityZ = 0; // Reset Z tilt angular velocity
                player.isDead = false;
            }
            continue;
        }
        const input = inputStates[id] || { w: false, a: false, s: false, d: false };

        // Apply turning acceleration (Yaw)
        let turnDir = 1;
        if (input.s && !input.w) turnDir = -1; // Reverse turning when only moving backward
        if (input.a) player.angularVelocity += TURN_ACCELERATION * turnDir;
        if (input.d) player.angularVelocity -= TURN_ACCELERATION * turnDir;

        // Apply angular friction (Yaw)
        player.angularVelocity *= ANGULAR_FRICTION;

        // Update Yaw rotation
        player.rotation += player.angularVelocity;

        // Apply acceleration based on Yaw rotation
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

        // Apply friction (car-like with sideways component)
        const forwardX = Math.sin(player.rotation);
        const forwardZ = Math.cos(player.rotation);
        const rightX = Math.cos(player.rotation);
        const rightZ = -Math.sin(player.rotation);

        const forwardSpeed = player.velocityX * forwardX + player.velocityZ * forwardZ;
        const sidewaysSpeed = player.velocityX * rightX + player.velocityZ * rightZ;

        // Apply base friction to forward speed
        const newForwardSpeed = forwardSpeed * FRICTION;
        // Apply much higher friction to sideways speed
        const newSidewaysSpeed = sidewaysSpeed * (1 - (1 - FRICTION) * SIDEWAYS_FRICTION_MULTIPLIER);

        // Reconstruct velocity vector
        player.velocityX = forwardX * newForwardSpeed + rightX * newSidewaysSpeed;
        player.velocityZ = forwardZ * newForwardSpeed + rightZ * newSidewaysSpeed;

        // Clamp speed
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

        // Update position (including Y)
        player.position.x += player.velocityX;
        player.position.y += player.velocityY;
        player.position.z += player.velocityZ;

        // --- START: Stop horizontal movement for scared jumping timid sheep ---
        if (player.personality === 'timid' && player.scaredTimer > 0 && player.position.y > GROUND_Y) {
            player.velocityX = 0;
            player.velocityZ = 0;
            // --- START: Add rapid backflip angular velocity while jumping ---
            player.angularVelocityX = -0.7; // Negative = backflip, adjust magnitude for speed
            // --- END: Add rapid backflip angular velocity ---
        }
        // --- END: Stop horizontal movement ---

        // Ground constraint
        if (player.position.y < GROUND_Y) {
            player.position.y = GROUND_Y;
            player.velocityY = 0; // Stop vertical movement when hitting ground
            // Apply ground friction to tilt angular velocities as well
            player.angularVelocityX = (player.angularVelocityX || 0) * 0.9; // Dampen tilt faster on ground
            player.angularVelocityZ = (player.angularVelocityZ || 0) * 0.9;
        }

        // --- Update Tilt Rotation (X and Z axes) ---
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
        // This adds the visual effect of leaning into turns, applied additively to collision tilt
        const targetTurningTiltZ = -player.angularVelocity * 5; // Target Z tilt due to turning yaw rate
        player.rotationZ = player.rotationZ * 0.95 + targetTurningTiltZ * 0.05; // Interpolate AFTER applying collision tilt angular velocity update

        // Snap small total Z rotation to zero if not turning and collision tilt is small
        if (Math.abs(player.rotationZ || 0) < 0.01 && Math.abs(player.angularVelocity) < 0.01 && Math.abs(player.angularVelocityZ || 0) < 0.01) {
             player.rotationZ = 0;
        }
        // Snap small total X rotation to zero if collision tilt is small
        if (Math.abs(player.rotationX || 0) < 0.01 && Math.abs(player.angularVelocityX || 0) < 0.01) {
            player.rotationX = 0;
        }

        // Check fence collision
        const distanceFromCenter = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
        if (distanceFromCenter >= FENCE_RADIUS) {
             if (!player.isDead) { // Only trigger death once
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
        // Timid: gets scared when touched (scaredTimer > 0)
        if (p === 'timid' && sheep.scaredTimer > 0) {
            // Only decrement the timer. The jump happens on collision.
            sheep.scaredTimer -= 1 / TICK_RATE;

            // --- START: Add fence avoidance while scared ---
            const dist = Math.sqrt(sheep.position.x ** 2 + sheep.position.z ** 2);
            const FENCE_AVOID_THRESHOLD = 0.9; // How close to get before turning away
            if (dist > FENCE_RADIUS * FENCE_AVOID_THRESHOLD) {
                const angleToCenter = Math.atan2(-sheep.position.x, -sheep.position.z);
                // Set target angle directly to turn away from fence
                sheep.aiTargetAngle = angleToCenter + (Math.random() - 0.5) * 0.4;
                // Reset the main AI timer to ensure this avoidance takes priority
                sheep.aiTimer = 0.1; // Short timer to allow re-evaluation quickly
            }
            // --- END: Add fence avoidance while scared ---
        }
        // Brave: usually avoids fence, but sometimes doesn't notice it
        else if (p === 'brave') {
            if (Math.random() < 0.8) { // 80% chance to avoid fence
                const dist = Math.sqrt(sheep.position.x ** 2 + sheep.position.z ** 2);
                if (dist > FENCE_RADIUS * 0.9) {
                    const angleToCenter = Math.atan2(-sheep.position.x, -sheep.position.z);
                    sheep.aiTargetAngle = angleToCenter + (Math.random() - 0.5) * 0.4;
                }
            }
            // 20% of the time, they just keep going (may hit fence)
        }
        // Curious: sometimes heads toward other sheep
        else if (p === 'curious') {
            if (Math.random() < 0.01) { // Occasionally
                let closestDist = 9999;
                let targetAngle = null;
                for (const otherId in players) {
                    if (otherId === id) continue;
                    const other = players[otherId];
                    if (!other || other.isDead) continue;
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
        // Lazy: moves slowly, changes direction rarely
        // Hyper: moves fast, changes direction often
        else if (p === 'hyper') {
            if (sheep.aiTimer <= 0) {
                sheep.aiTimer = 0.5 + Math.random() * 0.5;
            }
        }
        // Aggressive: seeks out and chases the nearest sheep
        else if (p === 'aggressive') {
            let closestDist = 9999;
            let targetAngle = null;
            for (const otherId in players) {
                if (otherId === id) continue;
                const other = players[otherId];
                if (!other || other.isDead) continue;
                const dx = other.position.x - sheep.position.x;
                const dz = other.position.z - sheep.position.z;
                const d = Math.sqrt(dx*dx + dz*dz);
                if (d < closestDist) {
                    closestDist = d;
                    targetAngle = Math.atan2(dx, dz);
                }
            }
            if (targetAngle !== null) {
                sheep.aiTargetAngle = targetAngle + (Math.random() - 0.5) * 0.2;
            }
        }
        // All: random walk
        sheep.aiTimer = (sheep.aiTimer || 0) - 1 / TICK_RATE;
        if (sheep.aiTimer <= 0 && (!['timid'].includes(p) || sheep.aiAvoidTimer <= 0)) {
            sheep.aiTargetAngle = Math.random() * Math.PI * 2;
            // Lazy sheep change direction rarely, hyper sheep often
            if (p === 'lazy') sheep.aiTimer = 5 + Math.random() * 5;
            else if (p === 'hyper') sheep.aiTimer = 0.5 + Math.random() * 0.5;
            else sheep.aiTimer = 2 + Math.random() * 3;
        }
        // Turn toward target angle
        let angleDiff = sheep.aiTargetAngle - sheep.rotation;
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        let turnSpeed = 0.07;
        let moveSpeed = 0.7;
        if (p === 'timid') { turnSpeed = 0.09; moveSpeed = 0.6; }
        if (p === 'brave') { turnSpeed = 0.05; moveSpeed = 0.8; }
        if (p === 'curious') { turnSpeed = 0.07; moveSpeed = 0.7; }
        if (p === 'lazy') { turnSpeed = 0.03; moveSpeed = 0.4; }
        if (p === 'hyper') { turnSpeed = 0.13; moveSpeed = 1.1; }
        sheep.angularVelocity = angleDiff * turnSpeed;
        sheep.rotation += sheep.angularVelocity;
        // Move forward
        sheep.velocityX += Math.sin(sheep.rotation) * ACCELERATION * moveSpeed;
        sheep.velocityZ += Math.cos(sheep.rotation) * ACCELERATION * moveSpeed;
    }

    // Broadcast game state
    const playerStates = Object.entries(players).map(([id, player]) => ({
        id,
        position: player.position,
        // Send all relevant rotation components (Y is the main player.rotation)
        rotation: { x: player.rotationX || 0, y: player.rotation || 0, z: player.rotationZ || 0 },
        isDead: player.isDead,
        personality: player.personality // Add personality for color
    }));
    // Use 'state' type for consistency if client expects it, otherwise 'update' is fine
    broadcast({ type: 'state', players: playerStates });
}, 1000 / TICK_RATE);

function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    const id = uuidv4();
    console.log('Client connected:', id); // Add log
    const spawnPos = getRandomSpawn(); // y is set here
    players[id] = {
        position: { ...spawnPos },
        spawn: { ...spawnPos },
        rotation: Math.random() * Math.PI * 2, // Initial Yaw rotation
        angularVelocity: 0, // Initial Yaw angular velocity
        velocityX: 0,
        velocityY: 0, // Initialize vertical velocity
        velocityZ: 0,
        isDead: false,
        respawnTimer: 0,
        rotationX: 0, // Initial X tilt
        rotationZ: 0, // Initial Z tilt
        angularVelocityX: 0, // Initial X tilt angular velocity
        angularVelocityZ: 0  // Initial Z tilt angular velocity
    };
    inputStates[id] = { w: false, a: false, s: false, d: false };

    // Send a simpler init message only to the new client
    ws.send(JSON.stringify({
        type: 'init',
        id,
        initialPlayerState: { ...players[id], personality: players[id].personality }
    }));

    // Inform *other* existing clients about the new player
    // Create the message payload first
    const connectMessage = JSON.stringify({
        type: 'connect',
        player: {
            id,
            position: players[id].position,
            rotation: { x: 0, y: players[id].rotation, z: 0 },
            isDead: false,
            personality: players[id].personality
        }
    });
    // Broadcast to others
    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) { // Check client !== ws
            client.send(connectMessage);
        }
    });

    ws.on('message', (message) => {
        try { // Add error handling for JSON parsing
            const data = JSON.parse(message);
            if (data.type === 'input' && inputStates[id]) { // Check if player still exists
                // Check if the received data has the expected 'key' and 'pressed' properties
                if (typeof data.key === 'string' && typeof data.pressed === 'boolean') {
                    // Update the specific key state based on the message
                    if (inputStates[id].hasOwnProperty(data.key)) { // Ensure the key is valid (w, a, s, d)
                        inputStates[id][data.key] = data.pressed;
                    }
                } else {
                    // Optional: Log if the input message format is unexpected but type is 'input'
                    console.warn(`Received input message with unexpected format for player ${id}:`, data);
                }
            }
        } catch (e) {
            console.error("Failed to parse message or invalid message format: ", message, e);
        }
    });
    ws.on('close', () => {
        console.log('Client disconnected:', id);
        delete players[id];
        delete inputStates[id];
        // Inform remaining clients about the disconnect
        broadcast({ type: 'disconnect', id });
    });
    ws.on('error', (error) => { // Add error handling for websocket errors
        console.error('WebSocket error for client:', id, error);
        delete players[id];
        delete inputStates[id];
        broadcast({ type: 'disconnect', id }); // Inform others on error too
    });
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Start server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});