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
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // Brighter ambient
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2); // Brighter directional
directionalLight.position.set(...LIGHTING.DIRECTIONAL_POSITION);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Load Textures
const textureLoader = new THREE.TextureLoader();
const grassTexture = textureLoader.load('./src/assets/grass-texture.jpg');
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
// Make the texture repeat many times across the ground
const textureRepeat = 50;  // Adjust this value to change the texture density
grassTexture.repeat.set(textureRepeat, textureRepeat);

// Load skybox texture
const skyboxTexture = textureLoader.load('./src/assets/skybox.jpg');

// Ground (grass)
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

// Connect fence posts with rails
for (let i = 0; i < fencePosts.length; i++) {
    const post1 = fencePosts[i];
    const post2 = fencePosts[(i + 1) % fencePosts.length];
      const railGeometry = new THREE.CylinderGeometry(VISUALS.FENCE_RAIL_RADIUS, VISUALS.FENCE_RAIL_RADIUS, post1.position.distanceTo(post2.position));
    const railMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.FENCE_COLOR });
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    
    const midPoint = new THREE.Vector3().addVectors(post1.position, post2.position).multiplyScalar(0.5);
    rail.position.copy(midPoint);
    
    rail.lookAt(post2.position);
    rail.rotateX(Math.PI / 2);
    
    rail.position.y = fenceHeight * 0.75;
    rail.castShadow = true;
    scene.add(rail);
}

// Skybox
const skyboxGeometry = new THREE.BoxGeometry(CAMERA.FAR * 0.8, CAMERA.FAR * 0.8, CAMERA.FAR * 0.8); // Large cube
const skyboxMaterial = new THREE.MeshBasicMaterial({ 
    map: skyboxTexture, 
    side: THREE.BackSide // Render on the inside
});
const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
scene.add(skybox);

// Camera setup
const camera = new THREE.PerspectiveCamera(
    CAMERA.FOV,
    window.innerWidth / window.innerHeight,
    CAMERA.NEAR,
    CAMERA.FAR
);

// Renderer setup
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputEncoding = THREE.sRGBEncoding; // Add this line
document.body.appendChild(renderer.domElement);

// Post-processing setup
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Pixelation Shader
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
            // Stronger non-linear pixelation: cubic interpolation and wider depth range
            float depth = gl_FragCoord.z / gl_FragCoord.w;
            float t = clamp(depth / 300.0, 0.0, 1.0); // 0 = near, 1 = far (increase 300.0 for more effect)
            float nonlinearT = pow(t, 3.0); // Cubic for more pronounced non-linearity
            float minPixel = pixelSize; // Near pixelation
            float maxPixel = pixelSize * 2.5; // Far pixelation (much more pixelated far away)
            float px = mix(minPixel, maxPixel, nonlinearT);
            vec2 dxy = px / resolution;
            vec2 coord = dxy * floor( vUv / dxy );
            gl_FragColor = texture2D(tDiffuse, coord);
        }
    `
};

const pixelPass = new ShaderPass(PixelShader);
pixelPass.uniforms['resolution'].value.set(window.innerWidth, window.innerHeight);
pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio);
composer.addPass(pixelPass);

// Gamma Correction Pass
const gammaCorrectionShader = {
    uniforms: {
        tDiffuse: { value: null },
        gamma: { value: 2.2 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float gamma;
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            color.rgb = pow(color.rgb, vec3(1.0 / gamma));
            gl_FragColor = color;
        }
    `
};
const gammaPass = new ShaderPass(gammaCorrectionShader);
composer.addPass(gammaPass);

// Input handling
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
        // Immediately create the local player's sheep
        if (data.initialPlayerState) {
            addOrUpdateSheep(data.initialPlayerState);
        } else {
            console.error("Init message missing initialPlayerState!");
        }
        // Request full state after init? Or rely on first state broadcast?
        // Let's rely on the first state broadcast for now.

    } else if (data.type === 'state') { // Changed from 'update' to 'state'
        // Add/update all sheep based on the full state
        const receivedIds = new Set();
        data.players.forEach(playerState => {
            addOrUpdateSheep(playerState);
            receivedIds.add(playerState.id);
        });

        // Remove sheep for players not in the current state message (safer than disconnect)
        for (const [id, sheep] of sheepMap.entries()) {
            if (!receivedIds.has(id)) {
                console.log("Removing sheep for ID (not in state):", id);
                removeSheep(id);
            }
        }

    } else if (data.type === 'connect') {
        // A new player joined
        console.log("Player connected:", data.player.id);
        addOrUpdateSheep(data.player); // Add the new sheep

    } else if (data.type === 'disconnect') {
        // A player left
        console.log("Player disconnected:", data.id);
        removeSheep(data.id); // Remove the sheep

    } else if (data.type === 'death') {
        // Show explosion for this player
        const sheep = sheepMap.get(data.id);
        if (sheep && !sheep.isDead) { // Check if not already marked dead client-side
            console.log("Player died:", data.id);
            sheep.isDead = true; // Mark as dead client-side
            if (sheep.group) sheep.group.visible = false; // Hide immediately

            // Create explosion at death position
            const explosion = createExplosion(data.position);
            scene.add(explosion);
            sheep.explosion = explosion;
            // Clean up explosion after duration
            setTimeout(() => {
                if (explosion.parent) {
                    scene.remove(explosion);
                }
                // Check if sheep still exists before clearing explosion ref
                const currentSheep = sheepMap.get(data.id);
                if (currentSheep && currentSheep.explosion === explosion) {
                    currentSheep.explosion = null;
                }
            }, EXPLOSION.DURATION_FRAMES * 1000 / 60); // Use config duration
        }
    } else {
        console.log("Received unknown message type:", data.type);
    }
};

// Helper function to add or update a sheep
function addOrUpdateSheep(playerState) {
    let sheep = sheepMap.get(playerState.id);

    // Determine color by personality if present
    let personalityColor = VISUALS.SHEEP_COLOR;
    if (playerState.personality && VISUALS.SHEEP_PERSONALITY_COLORS && VISUALS.SHEEP_PERSONALITY_COLORS[playerState.personality]) {
        personalityColor = VISUALS.SHEEP_PERSONALITY_COLORS[playerState.personality];
    }

    if (!sheep) {
        // Create new sheep if it doesn't exist
        console.log("Creating sheep for ID:", playerState.id);
        const group = new THREE.Group();
        // Body
        const bodyGeometry = new THREE.CapsuleGeometry(VISUALS.SHEEP_BODY_RADIUS, VISUALS.SHEEP_BODY_LENGTH, 4, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: personalityColor });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = Math.PI / 2; // Align capsule horizontally
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        // Head
        const headGroup = new THREE.Group(); // Group for head and eyes
        const headGeometry = new THREE.SphereGeometry(VISUALS.SHEEP_HEAD_RADIUS, 8, 8);
        const headMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_HEAD_COLOR });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.castShadow = true;
        head.receiveShadow = true;
        headGroup.add(head); // Add head to its group

        // Eyes
        const eyeGeometry = new THREE.SphereGeometry(VISUALS.SHEEP_HEAD_RADIUS * 0.2, 6, 6); // Smaller spheres for eyes
        const eyeMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_EYE_COLOR });
        const eyeLeft = new THREE.Mesh(eyeGeometry, eyeMaterial);
        const eyeRight = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eyeLeft.castShadow = true;
        eyeRight.castShadow = true;

        // Ears (top of head, pink for visibility)
        const earGeometry = new THREE.ConeGeometry(VISUALS.SHEEP_HEAD_RADIUS * 0.28, VISUALS.SHEEP_HEAD_RADIUS * 0.8, 12);
        const earMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_COLOR }); // Light pink for contrast
        const earLeft = new THREE.Mesh(earGeometry, earMaterial);
        const earRight = new THREE.Mesh(earGeometry, earMaterial);
        // Position ears slightly lower on the head
        const earY = VISUALS.SHEEP_HEAD_RADIUS * 0.8; // Lowered from 1.25
        const earZ = -VISUALS.SHEEP_HEAD_RADIUS * 0.2;
        const earX = VISUALS.SHEEP_HEAD_RADIUS * 0.55;
        earLeft.position.set(-earX, earY, earZ);
        earLeft.rotation.x = Math.PI;
        earLeft.rotation.z = Math.PI;
        earRight.position.set(earX, earY, earZ);
        earRight.rotation.x = Math.PI;
        earRight.rotation.z = -Math.PI;
        headGroup.add(earLeft);
        headGroup.add(earRight);

        // Position eyes relative to head center
        const eyeY = VISUALS.SHEEP_HEAD_RADIUS * 0.2;
        const eyeZ = VISUALS.SHEEP_HEAD_RADIUS * 0.9; // Forward position
        const eyeX = VISUALS.SHEEP_HEAD_RADIUS * 0.5; // Sideways position

        eyeLeft.position.set(-eyeX, eyeY, eyeZ);
        eyeRight.position.set(eyeX, eyeY, eyeZ);
        headGroup.add(eyeLeft);
        headGroup.add(eyeRight);

        // Move head further forward so ears are visible
        headGroup.position.z = VISUALS.SHEEP_BODY_LENGTH / 2 + VISUALS.SHEEP_HEAD_RADIUS * 0.8; // Increased from 0.8 to 1.3
        group.add(headGroup); // Add head group to the main sheep group
        // Legs
        const legGeometry = new THREE.CylinderGeometry(VISUALS.SHEEP_LEG_RADIUS, VISUALS.SHEEP_LEG_RADIUS, VISUALS.SHEEP_LEG_LENGTH);
        const legMaterial = new THREE.MeshStandardMaterial({ color: VISUALS.SHEEP_LEGS_COLOR });
        // Attach legs directly to the body (no offset)
        const legY = -VISUALS.SHEEP_BODY_RADIUS; // Only body radius, no leg length offset
        const legZFront = VISUALS.SHEEP_BODY_LENGTH / 2 * 0.7;
        const legZBack = -VISUALS.SHEEP_BODY_LENGTH / 2 * 0.7;
        const legX = VISUALS.SHEEP_BODY_RADIUS * 0.7;
        const legPositions = [
            [-legX, legY, legZFront], // Front left
            [ legX, legY, legZFront], // Front right
            [-legX, legY, legZBack],  // Back left
            [ legX, legY, legZBack]   // Back right
        ];
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, legMaterial);
            leg.position.set(pos[0], pos[1], pos[2]);
            leg.castShadow = true;
            leg.receiveShadow = true;
            group.add(leg);
        });

        group.position.set(playerState.position.x, playerState.position.y, playerState.position.z);
        scene.add(group);
        sheep = { group, isDead: playerState.isDead, explosion: null };
        sheepMap.set(playerState.id, sheep);
    }

    // Update existing sheep state
    sheep.group.position.set(playerState.position.x, playerState.position.y, playerState.position.z);
    // Update rotation using the object {x, y, z}
    if (playerState.rotation) {
        sheep.group.rotation.x = playerState.rotation.x || 0;
        sheep.group.rotation.y = playerState.rotation.y || 0; // Yaw
        sheep.group.rotation.z = playerState.rotation.z || 0;
    }
    sheep.isDead = playerState.isDead;
    sheep.group.visible = !playerState.isDead;
}

// Helper function to remove a sheep
function removeSheep(id) {
    const sheep = sheepMap.get(id);
    if (sheep) {
        if (sheep.group) scene.remove(sheep.group);
        if (sheep.explosion) scene.remove(sheep.explosion); // Clean up explosion if present
        sheepMap.delete(id);
    }
}

// Helper: get local player position (returns null if not found)
function getLocalPlayerPosition() {
    const sheep = sheepMap.get(localPlayerId);
    return sheep ? sheep.group.position : null;
}

// Helper: compute 2D distance between two THREE.Vector3
function get2DDistance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

// Helper: play 3D positional sound
function play3DSound(path, position, baseVolume = 1.0, pitch = 1.0) {
    // Get local player position
    const localPos = getLocalPlayerPosition();
    if (!localPos) return;
    // Compute 2D distance
    const dist = get2DDistance(localPos, position);
    // Stereo pan: -1 (left), 0 (center), 1 (right)
    const dx = position.x - localPos.x;
    const dz = position.z - localPos.z;
    const angle = Math.atan2(dx, dz); // Relative to player
    const pan = Math.sin(angle); // Simple left/right pan
    // Volume falloff
    const maxDist = ARENA.COLLISION_RADIUS * (EXPLOSION.PROXIMITY_SENSITIVITY !== undefined ? EXPLOSION.PROXIMITY_SENSITIVITY : 1.0);
    let volume = Math.max(0, baseVolume * (1 - dist / maxDist));
    // Create audio context for 3D effect
    const audio = new Audio(path);
    audio.playbackRate = pitch;
    // Use Web Audio API for panning
    try {
        const ctx = play3DSound.ctx || (play3DSound.ctx = new (window.AudioContext || window.webkitAudioContext)());
        const source = ctx.createMediaElementSource(audio);
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(panner).connect(gain).connect(ctx.destination);
        audio.onended = () => { source.disconnect(); panner.disconnect(); gain.disconnect(); };
        audio.play();
    } catch (e) {
        // Fallback: just set volume
        audio.volume = volume;
        audio.play();
    }
}

// Modified createExplosion to use play3DSound
function createExplosion(position) {
    // Doom-like 2D explosion using a configurable spritesheet
    const texture = new THREE.TextureLoader().load(EXPLOSION.SPRITESHEET);
    const frames = EXPLOSION.SPRITESHEET_FRAMES;
    const frameCols = EXPLOSION.SPRITESHEET_COLS;
    const frameRows = EXPLOSION.SPRITESHEET_ROWS;
    const frameWidth = 1 / frameCols;
    const frameHeight = 1 / frameRows;
    const size = EXPLOSION.SIZE * VISUALS.SHEEP_BODY_RADIUS; // Configurable explosion size

    // Proximity-based sound effect
    let volume = EXPLOSION.SOUND_VOLUME !== undefined ? EXPLOSION.SOUND_VOLUME : 1.0;
    const localPos = getLocalPlayerPosition();
    if (localPos) {
        const dist = get2DDistance(localPos, position);
        // Volume falls off linearly to 0 at (arena radius * proximity sensitivity)
        const maxDist = ARENA.COLLISION_RADIUS * (EXPLOSION.PROXIMITY_SENSITIVITY !== undefined ? EXPLOSION.PROXIMITY_SENSITIVITY : 1.0);
        volume = Math.max(0, volume * (1 - dist / maxDist));
    }
    play3DSound(EXPLOSION.SOUND_PATH || './src/assets/explode.wav', position, volume, EXPLOSION.SOUND_PITCH || 1.0);

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    // Start at frame 0
    material.map.repeat.set(frameWidth, frameHeight);
    material.map.offset.set(0, 0);

    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.lookAt(camera.position); // Always face camera

    scene.add(mesh);

    let currentFrame = 0;
    const totalFrames = frames;
    const frameDuration = EXPLOSION.DURATION_FRAMES / totalFrames; // frames per animation frame
    let frameCount = 0;

    function animateExplosion() {
        // Update to next frame if needed
        if (frameCount % Math.round(frameDuration) === 0 && currentFrame < totalFrames) {
            const u = (currentFrame % frameCols) * frameWidth;
            const v = 1 - frameHeight - Math.floor(currentFrame / frameCols) * frameHeight;
            material.map.offset.set(u, v);
            currentFrame++;
        }
        // Keep billboard facing camera
        mesh.lookAt(camera.position);
        frameCount++;
        if (currentFrame < totalFrames) {
            requestAnimationFrame(animateExplosion);
        } else {
            scene.remove(mesh);
        }
    }
    animateExplosion();
    return mesh;
}

// Background music
let bgMusic;
function playBackgroundMusic() {
    if (!bgMusic) {
        bgMusic = new Audio(MUSIC.PATH || './src/assets/bg-music1.mp3');
        bgMusic.loop = true;
        bgMusic.volume = MUSIC.VOLUME !== undefined ? MUSIC.VOLUME : 0.5;
    } else {
        bgMusic.volume = MUSIC.VOLUME !== undefined ? MUSIC.VOLUME : 0.5;
    }
    if (bgMusic.paused) {
        bgMusic.play();
    }
}
function pauseBackgroundMusic() {
    if (bgMusic && !bgMusic.paused) {
        bgMusic.pause();
    }
}
// Play music when tab is active, pause when not
window.addEventListener('focus', playBackgroundMusic);
window.addEventListener('blur', pauseBackgroundMusic);
// Also start music on load if tab is focused
if (document.hasFocus()) playBackgroundMusic();

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Camera follows local player
    const localSheep = sheepMap.get(localPlayerId);
    if (localSheep && !localSheep.isDead) {
        const distance = CAMERA.DISTANCE;
        const height = CAMERA.HEIGHT;

        // Calculate camera offset based on sheep's full rotation
        const cameraOffset = new THREE.Vector3(0, height, -distance); // Offset relative to sheep's local Z-axis
        cameraOffset.applyQuaternion(localSheep.group.quaternion); // Apply sheep's rotation to the offset

        // Calculate camera position
        const cameraPosition = new THREE.Vector3().copy(localSheep.group.position).add(cameraOffset);
        camera.position.copy(cameraPosition);

        // Make camera look at the sheep's position
        camera.lookAt(localSheep.group.position);
    }

    // Use composer to render with effects
    composer.render(); 
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // Resize composer
    // Update pixel shader resolution uniform
    pixelPass.uniforms['resolution'].value.set(window.innerWidth, window.innerHeight);
    pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio);
});

animate();
