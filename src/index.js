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
 * File principale dell'applicazione.
 *
 * Responsabilità:
 * - crea scena, camera e renderer Three.js;
 * - crea la simulazione GPGPU;
 * - crea la geometria dei boids;
 * - gestisce GUI, resize, mouse e animation loop.
 *
 * Migliorie aggiunte:
 * - numero di boids modificabile dalla GUI;
 * - numero di specie modificabile dalla GUI;
 * - colori diversi per specie;
 * - coesione solo tra boids della stessa specie;
 * - cielo procedurale al posto dello sfondo bianco;
 * - più torri procedurali con evitamento ostacoli.
 */

const BOUNDS = 800;

const settings = {
    boids: 1024,
    species: 1,
    separation: 20.0,
    alignment: 20.0,
    cohesion: 20.0,
    centered: 5.0, // valore di default = comportamento precedente (era fisso nello shader)
    skyElevation: 8,
    skyAzimuth: 180,
    skyTurbidity: 6,
    skyRayleigh: 2,
    obstacles: [
        { x: 300, z: 0, height: 300, radius: 40, undergroundDepth: 500 },
        { x: -280, z: 220, height: 220, radius: 35, undergroundDepth: 500 },
        { x: 0, z: -350, height: 260, radius: 45, undergroundDepth: 500 }
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
    scene.fog = new THREE.Fog(0xd6e6f5, 200, 1600);

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
     * Finora la scena non aveva nessuna luce: le farfalle usano uno
     * shader "unlit" (il colore è passato direttamente come vertex
     * color), quindi non ne avevano bisogno. Le torri, invece, usano un
     * MeshStandardMaterial realistico e senza luci risulterebbero nere.
     *
     * sunLight (direzionale) simula il sole e viene tenuta sincronizzata
     * con la posizione del sole del cielo procedurale in updateSun().
     * hemiLight aggiunge un riempimento morbido (cielo sopra, terreno
     * sotto) per evitare ombre completamente nere.
     */
    sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x2b2b2b, 0.6);
    scene.add(hemiLight);
}

function initSky() {
    /*
     * Cielo procedurale (modello di Preetham), sostituisce lo sfondo
     * bianco piatto. È una "cupola" enorme (BoxGeometry con BackSide)
     * centrata sulla camera concettualmente all'infinito: la scaliamo
     * molto più grande della scena dei boid (BOUNDS = 800) e ben dentro
     * il far plane della camera (20000), così resta sempre visibile
     * dietro tutto il resto senza clipping.
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

function initObstacles() {
    /*
     * Torri procedurali: nessun modello esterno, solo primitive di
     * Three.js. Una mesh (gruppo cilindro+cono) per ogni voce di
     * settings.obstacles.
     *
     * Sia il cilindro che il cono di Three.js sono centrati verticalmente
     * (da -0.5 a +0.5 in y locale): per posizionarli correttamente li
     * spostiamo di metà della loro altezza scalata, esattamente come
     * nella versione a torre singola.
     */
    obstacleMeshes = settings.obstacles.map(() => {
        const group = new THREE.Group();

        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x8a8378,
            roughness: 0.85,
            metalness: 0.05
        });

        const roofMaterial = new THREE.MeshStandardMaterial({
            color: 0x6b3f2a,
            roughness: 0.7,
            metalness: 0.05
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
    settings.obstacles.forEach((obstacle, index) => {
        const group = obstacleMeshes[index];

        if (!group) return;

        const { x, z, height, radius, undergroundDepth } = obstacle;

        const body = group.getObjectByName('towerBody');
        const roof = group.getObjectByName('towerRoof');

        const totalHeight = height + undergroundDepth;
        body.scale.set(radius, totalHeight, radius);
        body.position.set(0, (height - undergroundDepth) / 2, 0);

        /*
         * Il tetto è proporzionato al raggio della torre (non
         * all'altezza), così resta visivamente coerente anche con torri
         * molto alte o molto basse. Viene posizionato appena sopra la
         * cima del cilindro.
         */
        const roofRadius = radius * 1.15;
        const roofHeight = radius * 1.4;

        roof.scale.set(roofRadius, roofHeight, roofRadius);
        roof.position.set(0, height + roofHeight / 2, 0);

        group.position.set(x, -250, z);
    });

    /*
     * Sincronizza le uniform dello shader di velocità con le torri
     * visibili, così l'evitamento ostacoli corrisponde esattamente a
     * ciò che si vede in scena (usiamo solo il corpo cilindrico come
     * volume di collisione, il tetto resta puramente decorativo, ma il
     * margine di sicurezza nello shader lo copre comunque).
     */
    if (simulation) {
        simulation.setObstacles(settings.obstacles);
    }
}

function initGui() {
    gui = new GUI();

    /*
     * Parametri strutturali.
     * Richiedono la ricostruzione della simulazione.
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
     * Parametri comportamentali.
     * Non richiedono ricostruzione: aggiornano solo le uniform.
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
     * Parametri del cielo.
     * Non richiedono ricostruzione della simulazione, agiscono solo
     * sulle uniform dello shader del cielo.
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
     * Parametri delle torri.
     * Una sottocartella per ogni torre presente in settings.obstacles.
     * Tutte aggiornano sia le mesh visibili che le uniform di collisione
     * dello shader di velocità, tramite updateObstacles().
     */
    const obstaclesFolder = gui.addFolder('Obstacles (Towers)');

    settings.obstacles.forEach((obstacle, index) => {
        const towerFolder = obstaclesFolder.addFolder(`Torre ${index + 1}`);

        towerFolder.add(obstacle, 'x', -BOUNDS, BOUNDS, 5)
            .name('Position X')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'z', -BOUNDS, BOUNDS, 5)
            .name('Position Z')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'height', 50, 700, 5)
            .name('Height')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'radius', 10, 150, 1)
            .name('Radius')
            .onChange(updateObstacles);

        towerFolder.add(obstacle, 'undergroundDepth', 0, 1500, 10)
            .name('Underground Depth')
            .onChange(updateObstacles);
    });

    gui.close();
}

function rebuildSimulation() {
    /*
     * Rimozione della vecchia mesh dalla scena.
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
     * Rimozione della vecchia simulazione GPGPU, se presente.
     */
    if (simulation) {
        simulation.dispose();
        simulation = null;
    }

    /*
     * Ricostruzione della simulazione con i nuovi parametri.
     * Il numero di torri (settings.obstacles.length) viene passato al
     * costruttore perché diventa un define GLSL fisso (MAX_OBSTACLES).
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