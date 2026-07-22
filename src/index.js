import './style.css';

import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { BirdGeometry } from './BirdGeometry.js';
import { BoidsSimulation } from './simulation.js';
import { Sky } from 'three/addons/objects/Sky.js';

import birdVertexShader from './shaders/birdVertex.glsl?raw';
import birdFragmentShader from './shaders/birdFragment.glsl?raw';

/*
 * index.js
 *
 * Main application file.
 *
 * Responsibilities:
 * - creates the Three.js scene, camera and renderer;
 * - creates the GPGPU simulation;
 * - creates the bird (boid) geometry;
 * - manages the GUI, resize, mouse input and animation loop.
 *
 * Features:
 * - boid count adjustable from the GUI;
 * - species count adjustable from the GUI;
 * - different colors per species;
 * - cohesion only between boids of the same species;
 * - procedural sky instead of a flat white background;
 * - a configurable number of procedural towers with obstacle avoidance.
 */

const BOUNDS = 800;

/*
 * Minimum horizontal distance a tower must keep from the camera.
 * Without this, a tower could end up positioned right where the camera
 * sits, effectively placing the camera inside the solid tower geometry
 * (the screen would just show a flat, close-up color).
 */
const MIN_TOWER_CAMERA_DISTANCE = 100;

/*
 * The vertical portion of each tower that extends below y = 0 (the
 * conceptual "ground" level used by the collision uniforms). This is
 * fixed at its maximum useful value rather than user-configurable: the
 * whole point is that the tower base should never be visible, no matter
 * the camera angle, so there is no legitimate reason to ever lower it.
 */
const OBSTACLE_UNDERGROUND_DEPTH = 1500;

const MIN_TOWER_COUNT = 1;
const MAX_TOWER_COUNT = 5;

const settings = {
    boids: 1024,
    species: 1,
    separation: 20.0,
    alignment: 20.0,
    cohesion: 20.0,
    centered: 5.0, // default value = previous behaviour (was hardcoded in the shader)
    skyElevation: 8,
    skyAzimuth: 180,
    skyTurbidity: 6,
    skyRayleigh: 2,
    towerCount: 3,
    obstacles: [
        { x: 300, z: 0, height: 300, radius: 40 },
        { x: -280, z: 220, height: 220, radius: 35 },
        { x: 0, z: -350, height: 260, radius: 45 }
    ]
};

let container;
let stats;
let camera;
let scene;
let renderer;
let gui;

let mouseX = 0;
let mouseY = 0;

let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;

let last = performance.now();

let simulation;
let birdUniforms;
let birdMesh;

let sky;
const sun = new THREE.Vector3();
let sunLight;

let obstacleMeshes = [];

/*
 * Reference to the GUI folder containing all per-tower subfolders, and
 * one { xController, zController } pair per tower, kept in sync with
 * settings.obstacles by index. Needed so that when a tower's position is
 * clamped away from the camera (see clampObstacleDistanceFromCamera),
 * the displayed slider value can be refreshed to match the clamped one.
 */
let obstaclesFolder = null;
let towerControllers = [];

let towerBodyTexture = null;
let towerRoofTexture = null;

init();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        1,
        20000
    );
    camera.position.z = 350;

    scene = new THREE.Scene();

    /*
     * Fog range widened a bit compared to the initial version: towers
     * placed further back (e.g. around z = -350) were fading almost
     * completely white well before reaching the edge of the visible
     * area. This keeps that same soft atmospheric fade, just further out.
     */
    scene.fog = new THREE.Fog(0xd6e6f5, 200, 2600);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;

    container.appendChild(renderer.domElement);

    stats = new Stats();
    container.appendChild(stats.dom);

    container.style.touchAction = 'none';
    container.addEventListener('pointermove', onPointerMove);

    window.addEventListener('resize', onWindowResize);

    initLights();
    initSky();
    initObstacles();
    initGui();
    rebuildSimulation();
}

function initLights() {
    /*
     * The scene previously had no lights at all: the birds use an unlit
     * shader (color is passed directly as a vertex color), so they never
     * needed any. The towers, however, use a realistic
     * MeshStandardMaterial and would render pitch black without lights.
     *
     * sunLight (directional) simulates the sun and is kept in sync with
     * the procedural sky's sun position in updateSun(). hemiLight adds a
     * soft fill (sky color from above, ground color from below) so
     * shadowed areas are not fully black.
     */
    sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x2b2b2b, 0.6);
    scene.add(hemiLight);
}

function initSky() {
    /*
     * Procedural sky (Preetham model), replacing the flat white
     * background. It's a huge "dome" (a box geometry rendered with
     * BackSide) conceptually centered on the camera at infinity: we
     * scale it far larger than the boid scene (BOUNDS = 800) and safely
     * within the camera's far plane (20000), so it always stays visible
     * behind everything else without clipping.
     */
    sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = settings.skyTurbidity;
    uniforms['rayleigh'].value = settings.skyRayleigh;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.8;

    updateSun();
}

function updateSun() {
    const phi = THREE.MathUtils.degToRad(90 - settings.skyElevation);
    const theta = THREE.MathUtils.degToRad(settings.skyAzimuth);

    sun.setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms['sunPosition'].value.copy(sun);

    if (sunLight) {
        sunLight.position.copy(sun).multiplyScalar(2000);
    }
}

/*
 * Procedural brick texture (canvas-based), used both as a color map and
 * as a bump map: no external image files are involved. The mortar lines
 * (drawn darker) read as recessed grooves once combined with the
 * scene's lighting through the bump map, giving the tower body some real
 * surface depth instead of a flat, uniform cylinder.
 *
 * Lazily created once and shared by every tower's body material.
 */
function getTowerBodyTexture() {
    if (towerBodyTexture) return towerBodyTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#9c9285';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#55493f';

    const brickWidth = 64;
    const brickHeight = 32;
    const mortarThickness = 5;

    for (let y = 0; y < canvas.height; y += brickHeight) {
        // Horizontal mortar line.
        ctx.fillRect(0, y, canvas.width, mortarThickness);

        // Vertical mortar lines, offset every other row for a running
        // bond brick pattern.
        const rowIndex = Math.floor(y / brickHeight);
        const rowOffset = (rowIndex % 2 === 0) ? 0 : brickWidth / 2;

        for (let x = -brickWidth; x < canvas.width + brickWidth; x += brickWidth) {
            ctx.fillRect(x + rowOffset, y, mortarThickness, brickHeight);
        }
    }

    towerBodyTexture = new THREE.CanvasTexture(canvas);
    towerBodyTexture.wrapS = THREE.RepeatWrapping;
    towerBodyTexture.wrapT = THREE.RepeatWrapping;
    towerBodyTexture.repeat.set(4, 8);

    return towerBodyTexture;
}

/*
 * Procedural shingle-like texture for the conical roof, same idea as the
 * brick texture above: darker grooves read as recessed once lit.
 */
function getTowerRoofTexture() {
    if (towerRoofTexture) return towerRoofTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#7a4a32';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#4a2c1c';
    ctx.lineWidth = 4;

    const rowHeight = 24;

    for (let y = 0; y < canvas.height; y += rowHeight) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    for (let x = 0; x < canvas.width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    towerRoofTexture = new THREE.CanvasTexture(canvas);
    towerRoofTexture.wrapS = THREE.RepeatWrapping;
    towerRoofTexture.wrapT = THREE.RepeatWrapping;
    towerRoofTexture.repeat.set(6, 3);

    return towerRoofTexture;
}

/*
 * Keeps a tower at least MIN_TOWER_CAMERA_DISTANCE away from the camera
 * (measured on the horizontal x/z plane, since the camera never moves
 * vertically). Mutates the given obstacle in place.
 */
function clampObstacleDistanceFromCamera(obstacle) {
    const dx = obstacle.x - camera.position.x;
    const dz = obstacle.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist >= MIN_TOWER_CAMERA_DISTANCE) return;

    if (dist < 0.0001) {
        // Degenerate case: the tower sits exactly at the camera's
        // position. Push it away along a fixed default direction to
        // avoid normalizing a zero-length vector.
        obstacle.x = camera.position.x + MIN_TOWER_CAMERA_DISTANCE;
        obstacle.z = camera.position.z;
        return;
    }

    const scale = MIN_TOWER_CAMERA_DISTANCE / dist;
    obstacle.x = camera.position.x + dx * scale;
    obstacle.z = camera.position.z + dz * scale;
}

/*
 * Default configuration for a newly added tower (when the user raises
 * Tower Count). Spreads towers evenly around a circle so they don't
 * all overlap by default.
 */
function createDefaultObstacle(index) {
    const angle = (index / MAX_TOWER_COUNT) * Math.PI * 2;
    const spreadRadius = 320;

    const obstacle = {
        x: Math.cos(angle) * spreadRadius,
        z: Math.sin(angle) * spreadRadius,
        height: 250,
        radius: 40
    };

    clampObstacleDistanceFromCamera(obstacle);

    return obstacle;
}

/*
 * Grows or shrinks settings.obstacles to match the requested tower
 * count, adding sensible defaults for new towers and simply truncating
 * the array when reducing the count.
 */
function resizeObstacles(count) {
    if (count > settings.obstacles.length) {
        while (settings.obstacles.length < count) {
            settings.obstacles.push(createDefaultObstacle(settings.obstacles.length));
        }
    } else {
        settings.obstacles.length = count;
    }
}

function disposeObstacleMeshes() {
    obstacleMeshes.forEach((group) => {
        scene.remove(group);

        group.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }

            /*
             * Materials are disposed, but the shared procedural textures
             * (towerBodyTexture / towerRoofTexture) are intentionally
             * left alive: they are created once and reused by every
             * tower, including the ones about to be recreated right
             * after this call.
             */
            if (child.material) {
                child.material.dispose();
            }
        });
    });

    obstacleMeshes = [];
}

function initObstacles() {
    /*
     * Procedural towers: no external models, just Three.js primitives.
     * One mesh (cylinder body + cone roof group) per entry in
     * settings.obstacles.
     *
     * Both the cylinder and the cone are vertically centered by Three.js
     * (from -0.5 to +0.5 in local y): to position them correctly they
     * are offset by half of their scaled height.
     */
    obstacleMeshes = settings.obstacles.map(() => {
        const group = new THREE.Group();

        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.85,
            metalness: 0.05,
            map: getTowerBodyTexture(),
            bumpMap: getTowerBodyTexture(),
            bumpScale: 1.5
        });

        const roofMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.7,
            metalness: 0.05,
            map: getTowerRoofTexture(),
            bumpMap: getTowerRoofTexture(),
            bumpScale: 1.0
        });

        const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), bodyMaterial);
        body.name = 'towerBody';

        const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), roofMaterial);
        roof.name = 'towerRoof';

        group.add(body);
        group.add(roof);

        scene.add(group);

        return group;
    });

    updateObstacles();
}

function updateObstacles() {
    settings.obstacles.forEach((obstacle) => {
        clampObstacleDistanceFromCamera(obstacle);
    });

    settings.obstacles.forEach((obstacle, index) => {
        const group = obstacleMeshes[index];

        if (!group) return;

        const { x, z, height, radius } = obstacle;

        const body = group.getObjectByName('towerBody');
        const roof = group.getObjectByName('towerRoof');

        const totalHeight = height + OBSTACLE_UNDERGROUND_DEPTH;
        body.scale.set(radius, totalHeight, radius);
        body.position.set(0, (height - OBSTACLE_UNDERGROUND_DEPTH) / 2, 0);

        /*
         * The roof is sized relative to the tower's radius (not its
         * height), so it stays visually consistent for both very tall
         * and very short towers. It sits right on top of the cylinder.
         */
        const roofRadius = radius * 1.15;
        const roofHeight = radius * 1.4;

        roof.scale.set(roofRadius, roofHeight, roofRadius);
        roof.position.set(0, height + roofHeight / 2, 0);

        group.position.set(x, -250, z);
    });

    /*
     * Refresh the displayed GUI values for x/z, in case
     * clampObstacleDistanceFromCamera changed them (otherwise the slider
     * would show a stale value that no longer matches the actual tower
     * position).
     */
    towerControllers.forEach(({ xController, zController }) => {
        xController.updateDisplay();
        zController.updateDisplay();
    });

    /*
     * Sync the velocity shader's collision uniforms with the visible
     * towers, so obstacle avoidance matches what's on screen exactly
     * (only the cylindrical body counts as collision volume, the roof is
     * purely decorative, though the avoidance safety margin covers it
     * to some extent anyway).
     */
    if (simulation) {
        simulation.setObstacles(settings.obstacles);
    }
}

/*
 * (Re)builds the "Obstacles (Towers)" GUI folder and its per-tower
 * subfolders from the current settings.obstacles array. Called once at
 * startup and again whenever Tower Count changes the number of towers.
 */
function buildObstaclesGui() {
    if (obstaclesFolder) {
        obstaclesFolder.destroy();
    }

    towerControllers = [];

    obstaclesFolder = gui.addFolder('Obstacles (Towers)');

    settings.obstacles.forEach((obstacle, index) => {
        const towerFolder = obstaclesFolder.addFolder(`Tower ${index + 1}`);

        const xController = towerFolder.add(obstacle, 'x', -BOUNDS, BOUNDS, 5)
            .name('Position X')
            .onChange(updateObstacles);

        const zController = towerFolder.add(obstacle, 'z', -BOUNDS, BOUNDS, 5)
            .name('Position Z')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'height', 50, 700, 5)
            .name('Height')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'radius', 10, 150, 1)
            .name('Radius')
            .onChange(updateObstacles);

        towerControllers.push({ xController, zController });
    });
}

function initGui() {
    gui = new GUI();

    /*
     * Structural parameters.
     * These require rebuilding the simulation.
     */
    gui.add(settings, 'boids', 100, 4096, 1)
        .name('Boids')
        .onFinishChange(() => {
            settings.boids = Math.floor(settings.boids);
            rebuildSimulation();
        });

    gui.add(settings, 'species', 1, 8, 1)
        .name('Species')
        .onFinishChange(() => {
            settings.species = Math.floor(settings.species);
            rebuildSimulation();
        });

    /*
     * Behavioural parameters.
     * These don't require a rebuild, they only update uniforms.
     */
    gui.add(settings, 'separation', 0.0, 100.0, 1.0)
        .name('Separation')
        .onChange(updateSimulationParameters);

    gui.add(settings, 'alignment', 0.0, 100.0, 0.001)
        .name('Alignment')
        .onChange(updateSimulationParameters);

    gui.add(settings, 'cohesion', 0.0, 100.0, 0.025)
        .name('Cohesion')
        .onChange(updateSimulationParameters);

    gui.add(settings, 'centered', 0.0, 20.0, 0.5)
        .name('Centered')
        .onChange(updateSimulationParameters);

    /*
     * Sky parameters.
     * These don't require rebuilding the simulation, they only affect
     * the sky shader's uniforms.
     */
    const skyFolder = gui.addFolder('Sky');

    skyFolder.add(settings, 'skyElevation', 0.0, 90.0, 1.0)
        .name('Sun Elevation')
        .onChange(updateSun);

    skyFolder.add(settings, 'skyAzimuth', 0.0, 360.0, 1.0)
        .name('Sun Azimuth')
        .onChange(updateSun);

    skyFolder.add(settings, 'skyTurbidity', 0.0, 20.0, 0.1)
        .name('Turbidity')
        .onChange((value) => {
            sky.material.uniforms['turbidity'].value = value;
        });

    skyFolder.add(settings, 'skyRayleigh', 0.0, 4.0, 0.05)
        .name('Rayleigh')
        .onChange((value) => {
            sky.material.uniforms['rayleigh'].value = value;
        });

    /*
     * Tower count.
     * Changing this resizes settings.obstacles, rebuilds the tower
     * meshes and their GUI subfolders, and rebuilds the simulation
     * (MAX_OBSTACLES is a compile-time shader define, so a new tower
     * count needs a fresh BoidsSimulation instance).
     */
    gui.add(settings, 'towerCount', MIN_TOWER_COUNT, MAX_TOWER_COUNT, 1)
        .name('Tower Count')
        .onFinishChange(() => {
            settings.towerCount = Math.round(settings.towerCount);

            resizeObstacles(settings.towerCount);
            disposeObstacleMeshes();
            initObstacles();
            buildObstaclesGui();
            rebuildSimulation();
        });

    /*
     * Per-tower parameters.
     * One subfolder per entry in settings.obstacles.
     */
    buildObstaclesGui();

    gui.close();
}

function rebuildSimulation() {
    /*
     * Remove the previous bird mesh from the scene.
     */
    if (birdMesh) {
        scene.remove(birdMesh);

        if (birdMesh.geometry) {
            birdMesh.geometry.dispose();
        }

        if (birdMesh.material) {
            birdMesh.material.dispose();
        }

        birdMesh = null;
    }

    /*
     * Dispose of the previous GPGPU simulation, if any.
     */
    if (simulation) {
        simulation.dispose();
        simulation = null;
    }

    /*
     * Rebuild the simulation with the current parameters.
     * The tower count (settings.obstacles.length) is passed to the
     * constructor because it becomes a fixed GLSL define (MAX_OBSTACLES).
     */
    simulation = new BoidsSimulation(
        renderer,
        settings.boids,
        settings.species,
        BOUNDS,
        settings.obstacles.length
    );

    initBirds();
    updateSimulationParameters();
    updateObstacles();
}

function updateSimulationParameters() {
    if (!simulation) return;

    simulation.setBoidsParameters({
        separation: settings.separation,
        alignment: settings.alignment,
        cohesion: settings.cohesion,
        centered: settings.centered
    });
}

function initBirds() {
    const geometry = new BirdGeometry(
        settings.boids,
        simulation.getTextureWidth(),
        settings.species
    );

    birdUniforms = {
        color: { value: new THREE.Color(0xff2200) },
        texturePosition: { value: null },
        textureVelocity: { value: null },
        time: { value: 1.0 },
        delta: { value: 0.0 }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: birdUniforms,
        vertexShader: birdVertexShader,
        fragmentShader: birdFragmentShader,
        side: THREE.DoubleSide
    });

    birdMesh = new THREE.Mesh(geometry, material);
    birdMesh.rotation.y = Math.PI / 2;
    birdMesh.matrixAutoUpdate = false;
    birdMesh.updateMatrix();

    scene.add(birdMesh);
}

function onWindowResize() {
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerMove(event) {
    if (event.isPrimary === false) return;

    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
}

function animate() {
    render();

    if (stats) {
        stats.update();
    }
}

function render() {
    if (!simulation || !birdUniforms) return;

    const now = performance.now();
    let delta = (now - last) / 1000;

    if (delta > 1) delta = 1;

    last = now;

    const predator = new THREE.Vector3(
        0.5 * mouseX / windowHalfX,
        -0.5 * mouseY / windowHalfY,
        0
    );

    simulation.update(now, delta, predator);

    birdUniforms.time.value = now;
    birdUniforms.delta.value = delta;
    birdUniforms.texturePosition.value = simulation.getPositionTexture();
    birdUniforms.textureVelocity.value = simulation.getVelocityTexture();

    mouseX = 10000;
    mouseY = 10000;

    renderer.render(scene, camera);
}