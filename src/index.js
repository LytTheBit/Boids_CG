import './style.css';

import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

import { BirdGeometry } from './BirdGeometry.js';
import { BoidsSimulation } from './simulation.js';

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
 * - coesione solo tra boids della stessa specie.
 */

const BOUNDS = 800;

const settings = {
    boids: 1024,
    species: 1,
    separation: 20.0,
    alignment: 20.0,
    cohesion: 20.0,
    freedom: 0.75
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

init();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        1,
        3000
    );
    camera.position.z = 350;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 100, 1000);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);

    container.appendChild(renderer.domElement);

    stats = new Stats();
    container.appendChild(stats.dom);

    container.style.touchAction = 'none';
    container.addEventListener('pointermove', onPointerMove);

    window.addEventListener('resize', onWindowResize);

    initGui();
    rebuildSimulation();
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

    gui.add(settings, 'freedom', 0.0, 1.0, 0.01)
        .name('Freedom')
        .onChange(updateSimulationParameters);

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
     */
    simulation = new BoidsSimulation(
        renderer,
        settings.boids,
        settings.species,
        BOUNDS
    );

    initBirds();
    updateSimulationParameters();
}

function updateSimulationParameters() {
    if (!simulation) return;

    simulation.setBoidsParameters({
        separation: settings.separation,
        alignment: settings.alignment,
        cohesion: settings.cohesion,
        freedom: settings.freedom
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