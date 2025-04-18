import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CAMERA, VISUALS, LIGHTING, ARENA, EXPLOSION, POST_PROCESSING, MUSIC } from './config.js';

// WebSocket setup
const ws = new WebSocket(`ws://${window.location.hostname}:3000`);

// Scene setup
const scene = new THREE.Scene();

let localPlayerId = null;
const sheepMap = new Map(); // id -> { group, explosion, isDead }

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2);
directionalLight.position.set(...LIGHTING.DIRECTIONAL_POSITION);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Load Textures
const textureLoader = new THREE.TextureLoader();
const grassTexture = textureLoader.load('./src/assets/grass-texture.jpg');
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
const textureRepeat = 50;  // Controls grass texture density
grassTexture.repeat.set(textureRepeat, textureRepeat);

const skyboxTexture = textureLoader.load('./src/assets/skybox.jpg');

// Ground
const groundGeometry = new THREE.CircleGeometry(
    ARENA.COLLISION_RADIUS + ARENA.VISUAL_RADIUS_OFFSET + (ARENA.GROUND_EXTRA_RADIUS || 0),
    ARENA.FENCE_SEGMENTS * 2
);
const groundMaterial = new THREE.MeshStandardMaterial({
    map: grassTexture,
    side: THREE.DoubleSide
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Fence
const fenceRadius = ARENA.COLLISION_RADIUS + ARENA.VISUAL_RADIUS_OFFSET;
const fenceSegments = ARENA.FENCE_SEGMENTS;
const fencePosts = [];
const fenceHeight = ARENA.FENCE_HEIGHT;

// Create fence posts
for (let i = 0; i < fenceSegments; i++) {
    const angle = (i / fenceSegments) * Math.PI * 2;
    const x = Math.cos(angle) * fenceRadius;
    const z = Math.sin(angle) * fenceRadius;
    const postGeometry = new THREE.CylinderGeometry(VISUALS.FENCE_POST_RADIUS, VISUALS.FENCE_POST_RADIUS, fenceHeight, 8);
    const postMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.FENCE_COLOR });
    const post = new THREE.Mesh(postGeometry, postMaterial);

    post.position.set(x, fenceHeight / 2, z);
    post.castShadow = true;
    scene.add(post);
    fencePosts.push(post);
}

// Create fence rails connecting posts
for (let i = 0; i < fencePosts.length; i++) {
    const post1 = fencePosts[i];
    const post2 = fencePosts[(i + 1) % fencePosts.length]; // Wrap around for the last rail
    const railGeometry = new THREE.CylinderGeometry(VISUALS.FENCE_RAIL_RADIUS, VISUALS.FENCE_RAIL_RADIUS, post1.position.distanceTo(post2.position));
    const railMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.FENCE_COLOR });
    const rail = new THREE.Mesh(railGeometry, railMaterial);

    const midPoint = new THREE.Vector3().addVectors(post1.position, post2.position).multiplyScalar(0.5);
    rail.position.copy(midPoint);

    // Orient the rail to point from post1 to post2
    rail.lookAt(post2.position);
    rail.rotateX(Math.PI / 2); // Correct orientation for cylinder

    rail.position.y = fenceHeight * 0.75; // Position rail near the top
    rail.castShadow = true;
    scene.add(rail);
}

// Skybox
const skyboxGeometry = new THREE.BoxGeometry(CAMERA.FAR * 0.8, CAMERA.FAR * 0.8, CAMERA.FAR * 0.8);
const skyboxMaterial = new THREE.MeshBasicMaterial({
    map: skyboxTexture,
    side: THREE.BackSide // Render texture on the inside faces
});
const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
scene.add(skybox);

// Camera
const camera = new THREE.PerspectiveCamera(
    CAMERA.FOV,
    window.innerWidth / window.innerHeight,
    CAMERA.NEAR,
    CAMERA.FAR
);

// Renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputEncoding = THREE.sRGBEncoding; // Handle color space correctly
document.body.appendChild(renderer.domElement);

// Post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Pixelation Shader Pass
const PixelShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'resolution': { value: new THREE.Vector2() },
        'pixelSize': { value: POST_PROCESSING.PIXELATION_LEVEL },
    },
    vertexShader: `
        varying highp vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float pixelSize;
        uniform vec2 resolution;
        varying highp vec2 vUv;

        void main(){
            // Apply non-linear pixelation based on depth
            float depth = gl_FragCoord.z / gl_FragCoord.w;
            float t = clamp(depth / 300.0, 0.0, 1.0); // Normalize depth (adjust 300.0 for range)
            float nonlinearT = pow(t, 3.0); // Cubic interpolation for stronger effect
            float minPixel = pixelSize; // Near pixelation size
            float maxPixel = pixelSize * 2.5; // Far pixelation size
            float px = mix(minPixel, maxPixel, nonlinearT); // Interpolate pixel size
            vec2 dxy = px / resolution;
            vec2 coord = dxy * floor( vUv / dxy ); // Calculate pixelated coordinates
            gl_FragColor = texture2D(tDiffuse, coord);
        }
    `
};
const pixelPass = new ShaderPass(PixelShader);
pixelPass.uniforms['resolution'].value.set(window.innerWidth, window.innerHeight);
pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio);
composer.addPass(pixelPass);

// Input handling (WASD keys)
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = true;
        ws.send(JSON.stringify({ type: 'input', key: e.key, pressed: true }));
    }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = false;
        ws.send(JSON.stringify({ type: 'input', key: e.key, pressed: false }));
    }
});

// WebSocket message handling
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
        localPlayerId = data.id;
        console.log("Received init, my ID:", localPlayerId);
        // Create the local player's sheep immediately based on initial state
        if (data.initialPlayerState) {
            addOrUpdateSheep(data.initialPlayerState);
        } else {
            console.error("Init message missing initialPlayerState!");
        }
        // Rely on subsequent 'state' messages for other players

    } else if (data.type === 'state') {
        // Process the full game state update
        const receivedIds = new Set();
        data.players.forEach(playerState => {
            addOrUpdateSheep(playerState);
            receivedIds.add(playerState.id);
        });

        // Remove sheep for players no longer present in the state message
        for (const [id, sheep] of sheepMap.entries()) {
            if (!receivedIds.has(id)) {
                console.log("Removing sheep for ID (not in state):", id);
                removeSheep(id);
            }
        }

    } else if (data.type === 'connect') {
        // A new player joined
        console.log("Player connected:", data.player.id);
        addOrUpdateSheep(data.player);

    } else if (data.type === 'disconnect') {
        // A player left
        console.log("Player disconnected:", data.id);
        removeSheep(data.id);

    } else if (data.type === 'death') {
        // Handle player death event
        const sheep = sheepMap.get(data.id);
        if (sheep && !sheep.isDead) { // Prevent multiple death triggers
            console.log("Player died:", data.id);
            sheep.isDead = true; // Mark as dead client-side
            if (sheep.group) sheep.group.visible = false; // Hide sheep model

            // Create explosion visual effect
            const explosion = createExplosion(data.position);
            scene.add(explosion);
            sheep.explosion = explosion; // Store reference for potential cleanup

            // Schedule explosion removal
            setTimeout(() => {
                if (explosion.parent) {
                    scene.remove(explosion);
                }
                // Clear explosion reference if it hasn't been replaced
                const currentSheep = sheepMap.get(data.id);
                if (currentSheep && currentSheep.explosion === explosion) {
                    currentSheep.explosion = null;
                }
            }, EXPLOSION.DURATION_FRAMES * 1000 / 60); // Convert config duration (ticks) to ms
        }
    } else {
        console.log("Received unknown message type:", data.type);
    }
};

// Helper function to add a new sheep or update an existing one
function addOrUpdateSheep(playerState) {
    let sheep = sheepMap.get(playerState.id);

    // Determine body color based on personality, fallback to default
    let personalityColor = VISUALS.SHEEP_COLOR;
    if (playerState.personality && VISUALS.SHEEP_PERSONALITY_COLORS && VISUALS.SHEEP_PERSONALITY_COLORS[playerState.personality]) {
        personalityColor = VISUALS.SHEEP_PERSONALITY_COLORS[playerState.personality];
    }

    if (!sheep) {
        // Create new sheep if it doesn't exist
        console.log("Creating sheep for ID:", playerState.id);
        const group = new THREE.Group(); // Main container for the sheep parts

        // Body (Capsule)
        const bodyGeometry = new THREE.CapsuleGeometry(VISUALS.SHEEP_BODY_RADIUS, VISUALS.SHEEP_BODY_LENGTH, 4, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: personalityColor });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = Math.PI / 2; // Align horizontally
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Head Group (Head + Eyes + Ears)
        const headGroup = new THREE.Group();
        const headGeometry = new THREE.SphereGeometry(VISUALS.SHEEP_HEAD_RADIUS, 8, 8);
        const headMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_HEAD_COLOR });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.castShadow = true;
        head.receiveShadow = true;
        headGroup.add(head);

        // Eyes
        const eyeGeometry = new THREE.SphereGeometry(VISUALS.SHEEP_HEAD_RADIUS * 0.2, 6, 6);
        const eyeMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_EYE_COLOR });
        const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
        const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eyeLeft.castShadow = true;
        eyeRight.castShadow = true;
        // Position eyes relative to head center
        const eyeY = VISUALS.SHEEP_HEAD_RADIUS * 0.2;
        const eyeZ = VISUALS.SHEEP_HEAD_RADIUS * 0.9; // Forward
        const eyeX = VISUALS.SHEEP_HEAD_RADIUS * 0.5; // Sideways
        eyeLeft.position.set(-eyeX, eyeY, eyeZ);
        eyeRight.position.set(eyeX, eyeY, eyeZ);
        headGroup.add(eyeLeft);
        headGroup.add(eyeRight);

        // Ears
        const earGeometry = new THREE.ConeGeometry(VISUALS.SHEEP_HEAD_RADIUS * 0.28, VISUALS.SHEEP_HEAD_RADIUS * 0.8, 12);
        const earMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_COLOR }); // Use body color for ears
        const earLeft = new THREE.Mesh(earGeometry, earMaterial);
        const earRight = new THREE.Mesh(earGeometry, earMaterial);
        // Position ears relative to head center
        const earY = VISUALS.SHEEP_HEAD_RADIUS * 0.8;
        const earZ = -VISUALS.SHEEP_HEAD_RADIUS * 0.2; // Slightly back
        const earX = VISUALS.SHEEP_HEAD_RADIUS * 0.55;
        earLeft.position.set(-earX, earY, earZ);
        earLeft.rotation.x = Math.PI; // Point down/back
        earLeft.rotation.z = Math.PI;
        earRight.position.set(earX, earY, earZ);
        earRight.rotation.x = Math.PI;
        earRight.rotation.z = -Math.PI;
        headGroup.add(earLeft);
        headGroup.add(earRight);

        // Position head group relative to body center
        headGroup.position.z = VISUALS.SHEEP_BODY_LENGTH / 2 + VISUALS.SHEEP_HEAD_RADIUS * 0.8; // Forward offset
        group.add(headGroup);

        // Legs
        const legGeometry = new THREE.CylinderGeometry(VISUALS.SHEEP_LEG_RADIUS, VISUALS.SHEEP_LEG_RADIUS, VISUALS.SHEEP_LEG_LENGTH);
        const legMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_LEGS_COLOR });
        // Position legs relative to body center
        const legY = -VISUALS.SHEEP_BODY_RADIUS; // Attach directly below body
        const legZFront = VISUALS.SHEEP_BODY_LENGTH / 2 * 0.7; // Front offset
        const legZBack = -VISUALS.SHEEP_BODY_LENGTH / 2 * 0.7; // Back offset
        const legX = VISUALS.SHEEP_BODY_RADIUS * 0.7; // Sideways offset
        const legPositions = [
            [-legX, legY, legZFront], [ legX, legY, legZFront], // Front pair
            [-legX, legY, legZBack],  [ legX, legY, legZBack]   // Back pair
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(pos[0], pos[1], pos[2]);
            leg.castShadow = true;
            leg.receiveShadow = true;
            group.add(leg);
        });

        // Set initial position and add to scene/map
        group.position.set(playerState.position.x, playerState.position.y, playerState.position.z);
        scene.add(group);
        sheep = { group, isDead: playerState.isDead, explosion: null };
        sheepMap.set(playerState.id, sheep);
    }

    // Update existing sheep state (position, rotation, visibility)
    sheep.group.position.set(playerState.position.x, playerState.position.y, playerState.position.z);
    if (playerState.rotation) {
        // Apply full rotation (X, Y, Z) from server state
        sheep.group.rotation.x = playerState.rotation.x || 0;
        sheep.group.rotation.y = playerState.rotation.y || 0; // Yaw
        sheep.group.rotation.z = playerState.rotation.z || 0;
    }
    sheep.isDead = playerState.isDead;
    sheep.group.visible = !playerState.isDead; // Hide if dead
}

// Helper function to remove a sheep from the scene and map
function removeSheep(id) {
    const sheep = sheepMap.get(id);
    if (sheep) {
        if (sheep.group) scene.remove(sheep.group);
        if (sheep.explosion) scene.remove(sheep.explosion); // Clean up active explosion effect
        sheepMap.delete(id);
    }
}

// Helper: get local player position (returns null if not found or dead)
function getLocalPlayerPosition() {
    const sheep = sheepMap.get(localPlayerId);
    return (sheep && !sheep.isDead) ? sheep.group.position : null;
}

// Helper: compute 2D distance (XZ plane) between two THREE.Vector3
function get2DDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}

// Helper: play a sound with 3D positioning (volume falloff, stereo panning)
function play3DSound(path, position, baseVolume = 1.0, pitch = 1.0) {
    const localPos = getLocalPlayerPosition();
    if (!localPos) return; // Don't play if local player doesn't exist or is dead

    const dist = get2DDistance(localPos, position);

    // Calculate stereo pan based on angle relative to player's forward direction (approximated)
    const dx = position.x - localPos.x;
    const dz = position.z - localPos.z;
    // Note: This simple pan doesn't account for player rotation. A true 3D audio node would be better.
    const angle = Math.atan2(dx, dz);
    const pan = Math.sin(angle); // -1 (left) to 1 (right)

    // Calculate volume based on distance and sensitivity config
    const maxDist = ARENA.COLLISION_RADIUS * (EXPLOSION.PROXIMITY_SENSITIVITY !== undefined ? EXPLOSION.PROXIMITY_SENSITIVITY : 1.0);
    let volume = Math.max(0, baseVolume * (1 - dist / maxDist)); // Linear falloff

    const audio = new Audio(path);
    audio.playbackRate = pitch;

    // Use Web Audio API for panning and gain control if available
    try {
        // Reuse audio context if already created
        const ctx = play3DSound.ctx || (play3DSound.ctx = new (window.AudioContext || window.webkitAudioContext)());
        const source = ctx.createMediaElementSource(audio);
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(panner).connect(gain).connect(ctx.destination);
        // Disconnect nodes when audio finishes to free resources
        audio.onended = () => { source.disconnect(); panner.disconnect(); gain.disconnect(); };
        audio.play();
    } catch (e) {
        // Fallback: just set volume if Web Audio API fails
        console.warn("Web Audio API failed for 3D sound, using simple volume.", e);
        audio.volume = volume;
        audio.play();
    }
}

// Creates and animates a 2D billboard explosion effect
function createExplosion(position) {
    const texture = new THREE.TextureLoader().load(EXPLOSION.SPRITESHEET);
    const frames = EXPLOSION.SPRITESHEET_FRAMES;
    const frameCols = EXPLOSION.SPRITESHEET_COLS;
    const frameRows = EXPLOSION.SPRITESHEET_ROWS;
    const frameWidth = 1 / frameCols;
    const frameHeight = 1 / frameRows;
    const size = EXPLOSION.SIZE * VISUALS.SHEEP_BODY_RADIUS;

    // Play explosion sound with 3D positioning
    play3DSound(
        EXPLOSION.SOUND_PATH || './src/assets/explode.wav', // Fallback path
        position,
        EXPLOSION.SOUND_VOLUME !== undefined ? EXPLOSION.SOUND_VOLUME : 1.0,
        EXPLOSION.SOUND_PITCH || 1.0
    );

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false, // Don't obscure objects behind it
        side: THREE.DoubleSide
    });
    // Configure texture for the first frame
    material.map.repeat.set(frameWidth, frameHeight);
    material.map.offset.set(0, 0);

    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.lookAt(camera.position); // Initial orientation towards camera

    scene.add(mesh);

    let currentFrame = 0;
    const totalFrames = frames;
    const frameDuration = EXPLOSION.DURATION_FRAMES / totalFrames; // Ticks per spritesheet frame
    let frameCount = 0; // Ticks elapsed for this explosion

    // Animation loop for the explosion sprite
    function animateExplosion() {
        // Advance spritesheet frame if enough time has passed
        if (frameCount % Math.round(frameDuration) === 0 && currentFrame < totalFrames) {
            const u = (currentFrame % frameCols) * frameWidth;
            // V coordinate needs to be calculated from the top-left (1.0) down
            const v = 1.0 - frameHeight - Math.floor(currentFrame / frameCols) * frameHeight;
            material.map.offset.set(u, v);
            currentFrame++;
        }

        // Keep the billboard facing the camera
        mesh.lookAt(camera.position);
        frameCount++;

        // Continue animation or remove if finished
        if (currentFrame < totalFrames) {
            requestAnimationFrame(animateExplosion);
        } else {
            if (mesh.parent) { // Check if still in scene before removing
                 scene.remove(mesh);
            }
        }
    }
    animateExplosion();
    return mesh; // Return the mesh in case it needs to be tracked/removed early
}

// Background music management
let bgMusic;
function playBackgroundMusic() {
    if (!bgMusic) {
        bgMusic = new Audio(MUSIC.PATH || './src/assets/bg-music1.mp3');
        bgMusic.loop = true;
        bgMusic.volume = MUSIC.VOLUME !== undefined ? MUSIC.VOLUME : 0.5;
    } else {
        // Update volume if it changed in config (e.g., via hot-reloading)
        bgMusic.volume = MUSIC.VOLUME !== undefined ? MUSIC.VOLUME : 0.5;
    }
    // Prevent errors if play() is called while already playing
    if (bgMusic.paused) {
        bgMusic.play().catch(e => console.warn("Background music play failed:", e));
    }
}
function pauseBackgroundMusic() {
    if (bgMusic && !bgMusic.paused) {
        bgMusic.pause();
    }
}
// Auto-play/pause based on tab focus
window.addEventListener('focus', playBackgroundMusic);
window.addEventListener('blur', pauseBackgroundMusic);
// Initial play if tab is focused on load
if (document.hasFocus()) playBackgroundMusic();

// Main animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update camera to follow the local player
    const localSheep = sheepMap.get(localPlayerId);
    if (localSheep && !localSheep.isDead) {
        const distance = CAMERA.DISTANCE;
        const height = CAMERA.HEIGHT;

        // Calculate camera offset relative to the sheep's orientation
        const cameraOffset = new THREE.Vector3(0, height, -distance); // Base offset behind the sheep
        cameraOffset.applyQuaternion(localSheep.group.quaternion); // Rotate offset by sheep's rotation

        // Calculate target camera position
        const cameraPosition = new THREE.Vector3().copy(localSheep.group.position).add(cameraOffset);
        camera.position.copy(cameraPosition);

        // Point camera towards the sheep
        camera.lookAt(localSheep.group.position);
    }

    // Render the scene through the EffectComposer (applies post-processing)
    composer.render();
}

// Handle window resizing
window.addEventListener('resize', () => {
    // Update camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // Update renderer and composer size
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);

    // Update pixelation shader resolution uniform
    pixelPass.uniforms['resolution'].value.set(window.innerWidth, window.innerHeight);
    pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio);
});

// Start the animation loop
animate();
